use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

const SERVICE_LABEL: &str = "com.almatzhanabekov.finance.telegramd";
const APP_IDENTIFIER: &str = "com.almatzhanabekov.finance";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramDaemonStatus {
    pub installed: bool,
    pub running: bool,
    pub platform_supported: bool,
    pub binary_path: Option<String>,
    pub detail: String,
}

fn support_dir() -> Result<PathBuf, String> {
    let base = dirs_next().ok_or_else(|| "Не найден каталог данных".to_string())?;
    Ok(base.join(APP_IDENTIFIER))
}

fn dirs_next() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs_home().map(|h| h.join("Library").join("Application Support"))
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| dirs_home().map(|h| h.join(".local").join("share")))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        None
    }
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn installed_daemon_path() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        Ok(support_dir()?.join("bin").join("finance-telegramd.exe"))
    }
    #[cfg(not(windows))]
    {
        Ok(support_dir()?.join("bin").join("finance-telegramd"))
    }
}

#[cfg(target_os = "macos")]
fn launch_agent_plist_path() -> Result<PathBuf, String> {
    let home = dirs_home().ok_or_else(|| "Не найден домашний каталог".to_string())?;
    Ok(home
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{SERVICE_LABEL}.plist")))
}

#[cfg(target_os = "linux")]
fn systemd_unit_path() -> Result<PathBuf, String> {
    let home = dirs_home().ok_or_else(|| "Не найден домашний каталог".to_string())?;
    Ok(home
        .join(".config")
        .join("systemd")
        .join("user")
        .join("finance-telegramd.service"))
}

fn find_source_daemon() -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["finance-telegramd", "finance-telegramd.exe"] {
                let sibling = dir.join(name);
                if sibling.is_file() {
                    return Ok(sibling);
                }
            }
            #[cfg(target_os = "macos")]
            {
                if let Some(contents) = dir.parent() {
                    let resource_candidates = [
                        contents.join("Resources").join("finance-telegramd"),
                        contents
                            .join("Resources")
                            .join("resources")
                            .join("finance-telegramd"),
                    ];
                    for resource in resource_candidates {
                        if resource.is_file() {
                            return Ok(resource);
                        }
                    }
                }
            }
        }
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for rel in [
        "../target/debug/finance-telegramd",
        "../target/release/finance-telegramd",
        "target/debug/finance-telegramd",
        "target/release/finance-telegramd",
    ] {
        let candidate = manifest.join(rel);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(
        "Бинарник finance-telegramd не найден. Соберите: cargo build -p finance-telegramd"
            .into(),
    )
}

fn copy_daemon_binary() -> Result<PathBuf, String> {
    let source = find_source_daemon()?;
    let dest = installed_daemon_path()?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Не создать bin/: {e}"))?;
    }
    fs::copy(&source, &dest).map_err(|e| format!("Не скопировать службу: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&dest)
            .map_err(|e| format!("metadata: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&dest, perms).map_err(|e| format!("chmod: {e}"))?;
    }
    Ok(dest)
}

#[cfg(target_os = "macos")]
fn write_launch_agent(daemon: &Path) -> Result<(), String> {
    let plist_path = launch_agent_plist_path()?;
    if let Some(parent) = plist_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("LaunchAgents: {e}"))?;
    }
    let log = support_dir()?.join("logs");
    fs::create_dir_all(&log).map_err(|e| format!("logs: {e}"))?;
    let stdout = log.join("telegramd.log");
    let stderr = log.join("telegramd.err.log");
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{}</string>
  <key>StandardErrorPath</key>
  <string>{}</string>
</dict>
</plist>
"#,
        daemon.display(),
        stdout.display(),
        stderr.display()
    );
    fs::write(&plist_path, plist).map_err(|e| format!("plist: {e}"))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn write_systemd_unit(daemon: &Path) -> Result<(), String> {
    let unit = systemd_unit_path()?;
    if let Some(parent) = unit.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("systemd: {e}"))?;
    }
    let log = support_dir()?.join("logs");
    fs::create_dir_all(&log).map_err(|e| format!("logs: {e}"))?;
    let content = format!(
        r#"[Unit]
Description=Finance Telegram bot daemon
After=network-online.target

[Service]
ExecStart={}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
"#,
        daemon.display()
    );
    fs::write(&unit, content).map_err(|e| format!("unit: {e}"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn launchctl_bootstrap() -> Result<(), String> {
    let plist = launch_agent_plist_path()?;
    let uid = users_uid();
    let domain = format!("gui/{uid}");
    // Ignore errors from bootout if not loaded.
    let _ = Command::new("launchctl")
        .args(["bootout", &domain, plist.to_str().unwrap_or("")])
        .output();
    let output = Command::new("launchctl")
        .args(["bootstrap", &domain, plist.to_str().unwrap_or("")])
        .output()
        .map_err(|e| format!("launchctl: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("launchctl bootstrap: {err}"));
    }
    let _ = Command::new("launchctl")
        .args(["enable", &format!("{domain}/{SERVICE_LABEL}")])
        .output();
    let _ = Command::new("launchctl")
        .args(["kickstart", "-k", &format!("{domain}/{SERVICE_LABEL}")])
        .output();
    Ok(())
}

#[cfg(target_os = "macos")]
fn launchctl_bootout() -> Result<(), String> {
    let plist = launch_agent_plist_path()?;
    if !plist.exists() {
        return Ok(());
    }
    let uid = users_uid();
    let domain = format!("gui/{uid}");
    let _ = Command::new("launchctl")
        .args(["bootout", &domain, plist.to_str().unwrap_or("")])
        .output();
    let _ = fs::remove_file(&plist);
    Ok(())
}

#[cfg(target_os = "macos")]
fn users_uid() -> u32 {
    libc_getuid()
}

#[cfg(target_os = "macos")]
fn libc_getuid() -> u32 {
    // Avoid libc crate: parse `id -u`
    Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(501)
}

#[cfg(target_os = "linux")]
fn systemd_enable_start() -> Result<(), String> {
    let _ = Command::new("systemctl")
        .args(["--user", "daemon-reload"])
        .output();
    let output = Command::new("systemctl")
        .args(["--user", "enable", "--now", "finance-telegramd.service"])
        .output()
        .map_err(|e| format!("systemctl: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("systemctl: {err}"));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn systemd_disable_stop() -> Result<(), String> {
    let _ = Command::new("systemctl")
        .args(["--user", "disable", "--now", "finance-telegramd.service"])
        .output();
    if let Ok(path) = systemd_unit_path() {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn is_service_running() -> bool {
    let uid = users_uid();
    let output = Command::new("launchctl")
        .args(["print", &format!("gui/{uid}/{SERVICE_LABEL}")])
        .output();
    match output {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout);
            text.contains("state = running") || text.contains("pid =")
        }
        _ => false,
    }
}

#[cfg(target_os = "linux")]
fn is_service_running() -> bool {
    Command::new("systemctl")
        .args(["--user", "is-active", "--quiet", "finance-telegramd.service"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn is_service_running() -> bool {
    false
}

#[tauri::command]
pub fn telegram_daemon_status() -> Result<TelegramDaemonStatus, String> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let binary = installed_daemon_path().ok();
        let installed = binary.as_ref().is_some_and(|p| p.is_file())
            && {
                #[cfg(target_os = "macos")]
                {
                    launch_agent_plist_path().map(|p| p.exists()).unwrap_or(false)
                }
                #[cfg(target_os = "linux")]
                {
                    systemd_unit_path().map(|p| p.exists()).unwrap_or(false)
                }
            };
        let running = installed && is_service_running();
        Ok(TelegramDaemonStatus {
            installed,
            running,
            platform_supported: true,
            binary_path: binary.map(|p| p.display().to_string()),
            detail: if running {
                "Служба запущена и работает без приложения".into()
            } else if installed {
                "Служба установлена, но сейчас не запущена".into()
            } else {
                "Служба не установлена".into()
            },
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Ok(TelegramDaemonStatus {
            installed: false,
            running: false,
            platform_supported: false,
            binary_path: None,
            detail: "Фоновая служба пока поддерживается на macOS и Linux".into(),
        })
    }
}

#[tauri::command]
pub fn install_telegram_daemon() -> Result<TelegramDaemonStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let daemon = copy_daemon_binary()?;
        write_launch_agent(&daemon)?;
        launchctl_bootstrap()?;
        telegram_daemon_status()
    }
    #[cfg(target_os = "linux")]
    {
        let daemon = copy_daemon_binary()?;
        write_systemd_unit(&daemon)?;
        systemd_enable_start()?;
        telegram_daemon_status()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Err("Фоновая служба пока поддерживается на macOS и Linux".into())
    }
}

#[tauri::command]
pub fn uninstall_telegram_daemon() -> Result<TelegramDaemonStatus, String> {
    #[cfg(target_os = "macos")]
    {
        launchctl_bootout()?;
        if let Ok(path) = installed_daemon_path() {
            let _ = fs::remove_file(path);
        }
        telegram_daemon_status()
    }
    #[cfg(target_os = "linux")]
    {
        systemd_disable_stop()?;
        if let Ok(path) = installed_daemon_path() {
            let _ = fs::remove_file(path);
        }
        telegram_daemon_status()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Err("Фоновая служба пока поддерживается на macOS и Linux".into())
    }
}
