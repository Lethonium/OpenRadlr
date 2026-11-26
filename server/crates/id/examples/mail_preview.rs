//! Writes every account mail, in every language, as HTML and text files for a look in a
//! browser: `cargo run -p openradlr-id --example mail_preview -- <dir> [site]`.

use base64::Engine as _;
use openradlr_id::mail::{render, Message, BRAND_MARK, BRAND_MARK_CID};
use openradlr_id::mailer::Language;
use std::path::PathBuf;

fn main() -> std::io::Result<()> {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(args.next().unwrap_or_else(|| "mail-preview".into()));
    let site = args.next().unwrap_or_else(|| "https://app.openradlr.com".into());
    std::fs::create_dir_all(&dir)?;
    // Browsers don't know `cid:`; the preview shows the mark as a data URI instead.
    let mark = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(BRAND_MARK)
    );
    let messages = [
        (
            "code-new",
            Message::SignInCode {
                code: "042137".into(),
                new_account: true,
            },
        ),
        (
            "code",
            Message::SignInCode {
                code: "042137".into(),
                new_account: false,
            },
        ),
        (
            "passkey",
            Message::PasskeyAdded {
                name: "MacBook · 24.11.2026".into(),
                added_s: 1_795_532_400,
            },
        ),
        ("deleted", Message::AccountDeleted),
    ];
    for (language, tag) in [(Language::English, "en"), (Language::German, "de")] {
        for (name, message) in &messages {
            let mail = render(message, language, &site);
            let html = mail.html.replace(&format!("cid:{BRAND_MARK_CID}"), &mark);
            std::fs::write(dir.join(format!("{name}-{tag}.html")), html)?;
            std::fs::write(
                dir.join(format!("{name}-{tag}.txt")),
                format!("Subject: {}\n\n{}", mail.subject, mail.text),
            )?;
        }
    }
    println!("{}", dir.display());
    Ok(())
}
