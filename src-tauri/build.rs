use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    ensure_telegramd_sidecar();
    tauri_build::build()
}

fn ensure_telegramd_sidecar() {
    let target = env::var("TARGET").unwrap_or_else(|_| "unknown".into());
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let binaries_dir = manifest_dir.join("binaries");
    let is_windows = target.contains("windows");
    let dest = binaries_dir.join(if is_windows {
        format!("finance-telegramd-{target}.exe")
    } else {
        format!("finance-telegramd-{target}")
    });

    if dest.is_file() && fs::metadata(&dest).map(|m| m.len() > 64).unwrap_or(false) {
        return;
    }

    let bin_name = if is_windows {
        "finance-telegramd.exe"
    } else {
        "finance-telegramd"
    };
    let workspace_root = manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| manifest_dir.clone());
    let candidates = [
        workspace_root
            .join("target")
            .join(&target)
            .join("release")
            .join(bin_name),
        workspace_root
            .join("target")
            .join(&target)
            .join("debug")
            .join(bin_name),
        workspace_root.join("target").join("release").join(bin_name),
        workspace_root.join("target").join("debug").join(bin_name),
        manifest_dir.join("target").join("release").join(bin_name),
        manifest_dir.join("target").join("debug").join(bin_name),
    ];

    let _ = fs::create_dir_all(&binaries_dir);
    for source in candidates {
        if source.is_file() {
            if fs::copy(&source, &dest).is_ok() {
                eprintln!("cargo:warning=copied finance-telegramd sidecar from {}", source.display());
                return;
            }
        }
    }

    // Placeholder so `cargo check` / `tauri dev` can start before the daemon is built.
    // Real installs should run `npm run build:telegramd` (or release beforeBuildCommand).
    let placeholder = if is_windows {
        b"placeholder finance-telegramd - run npm run build:telegramd\r\n".to_vec()
    } else {
        b"#!/bin/sh\necho \"finance-telegramd not built; run: npm run build:telegramd\" >&2\nexit 1\n"
            .to_vec()
    };
    let _ = fs::write(&dest, placeholder);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(&dest) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(&dest, perms);
        }
    }
}
