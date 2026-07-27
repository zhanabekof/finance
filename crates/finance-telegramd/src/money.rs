fn currency_fraction_digits(currency: &str) -> u32 {
    match currency.to_ascii_uppercase().as_str() {
        "JPY" => 0,
        _ => 2,
    }
}

fn scale_for_currency(currency: &str) -> i64 {
    let digits = currency_fraction_digits(currency);
    let mut scale = 1_i64;
    for _ in 0..digits {
        scale = scale.saturating_mul(10);
    }
    scale
}

/// Parse a user-entered amount into signed minor units (integer only).
pub fn parse_money_input(input: &str, currency: &str) -> Result<i64, String> {
    let mut trimmed = input.trim().replace(' ', "").replace(',', ".");
    if trimmed.is_empty() || trimmed == "-" || trimmed == "+" || trimmed == "." {
        return Err("Введите сумму".into());
    }
    if trimmed.ends_with('.') {
        trimmed.pop();
    }
    if trimmed.is_empty() || trimmed == "-" || trimmed == "+" {
        return Err("Введите сумму".into());
    }

    let sign = if trimmed.starts_with('-') { -1 } else { 1 };
    let unsigned = trimmed.trim_start_matches(['+', '-']);
    let parts: Vec<&str> = unsigned.split('.').collect();
    if parts.is_empty() || parts.len() > 2 || parts[0].is_empty() {
        return Err("Некорректная сумма".into());
    }
    if !parts[0].chars().all(|c| c.is_ascii_digit()) {
        return Err("Некорректная сумма".into());
    }
    if let Some(frac) = parts.get(1) {
        if !frac.chars().all(|c| c.is_ascii_digit()) {
            return Err("Некорректная сумма".into());
        }
    }

    let digits = currency_fraction_digits(currency) as usize;
    let fraction_part = parts.get(1).copied().unwrap_or("");
    if fraction_part.len() > digits {
        return Err(format!("Максимум {digits} знака после запятой"));
    }

    let whole: i64 = parts[0]
        .parse()
        .map_err(|_| "Слишком большая сумма".to_string())?;
    let padded = format!("{:0<width$}", fraction_part, width = digits);
    let fraction: i64 = if digits == 0 {
        0
    } else {
        padded
            .parse()
            .map_err(|_| "Слишком большая сумма".to_string())?
    };
    let scale = scale_for_currency(currency);
    let minor = whole
        .checked_mul(scale)
        .and_then(|v| v.checked_add(fraction))
        .ok_or_else(|| "Слишком большая сумма".to_string())?;
    Ok(sign * minor)
}

pub fn format_money(amount_minor: i64, currency: &str) -> String {
    let digits = currency_fraction_digits(currency) as usize;
    let scale = scale_for_currency(currency).max(1);
    let sign = if amount_minor < 0 { "−" } else { "" };
    let abs = amount_minor.abs();
    let whole = abs / scale;
    if digits == 0 {
        return format!("{sign}{whole} {currency}");
    }
    let frac = abs % scale;
    format!("{sign}{whole}.{frac:0width$} {currency}", width = digits)
}
