//! The account mails: one layout, several messages, in English and German.
//!
//! Every mail is rendered twice from the same pieces: as HTML (a table layout
//! with inline styles, which is what mail clients render reliably, the brand
//! mark as an inline image, a dark variant where the client supports it) and
//! as plain text. Everything a rider or the server put in (a passkey's name,
//! an address) is escaped in the HTML.

use crate::mailer::Language;

/// The brand mark, attached inline: remote images are blocked by most clients.
pub const BRAND_MARK: &[u8] = include_bytes!("../assets/brand-mark.png");
/// How the HTML refers to [`BRAND_MARK`].
pub const BRAND_MARK_CID: &str = "brand-mark";

/// What a mail says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    /// A sign-in code; `new_account` when the address has no account yet.
    SignInCode { code: String, new_account: bool },
    /// A passkey was added to the account, at `added_s` (Unix seconds).
    PasskeyAdded { name: String, added_s: i64 },
    /// The account and its backups are gone.
    AccountDeleted,
}

/// A mail ready to send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rendered {
    pub subject: String,
    pub text: String,
    pub html: String,
    /// The code in it, for the development mailer's log.
    pub code: Option<String>,
}

/// The parts every message fills in; the layout turns them into text and HTML.
struct Parts {
    subject: String,
    /// The line clients show next to the subject in the inbox.
    preheader: String,
    heading: String,
    paragraphs: Vec<String>,
    code: Option<String>,
    button: Option<String>,
    note: Option<String>,
}

pub fn escape(text: &str) -> String {
    text.chars().fold(String::with_capacity(text.len()), |mut out, c| {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
        out
    })
}

/// The calendar date (UTC) of Unix seconds, from Howard Hinnant's days-to-civil.
fn civil_date(unix_s: i64) -> (i64, u32, u32) {
    let days = unix_s.div_euclid(86_400) + 719_468;
    let era = days.div_euclid(146_097);
    let doe = days.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = u32::try_from(doy - (153 * mp + 2) / 5 + 1).unwrap_or(1);
    let month = u32::try_from(if mp < 10 { mp + 3 } else { mp - 9 }).unwrap_or(1);
    let year = era * 400 + yoe + i64::from(month <= 2);
    (year, month, day)
}

fn date(unix_s: i64, language: Language) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let (year, month, day) = civil_date(unix_s);
    match language {
        Language::English => format!("{day} {} {year}", MONTHS[(month - 1) as usize]),
        Language::German => format!("{day:02}.{month:02}.{year}"),
    }
}

fn parts(message: &Message, language: Language) -> Parts {
    use Language::{English as En, German as De};
    match (message, language) {
        (Message::SignInCode { code, new_account }, En) => Parts {
            subject: format!("{code} is your OpenRadlr code"),
            preheader: "Your code works for 10 minutes.".into(),
            heading: if *new_account { "Welcome to OpenRadlr" } else { "Sign in to OpenRadlr" }.into(),
            paragraphs: vec![if *new_account {
                "Enter this code to create your account and keep your rides safe:"
            } else {
                "Enter this code to sign in:"
            }
            .into()],
            code: Some(code.clone()),
            button: None,
            note: Some(
                "The code works for 10 minutes. Didn't ask for it? Ignore this mail: nobody can sign in without the code."
                    .into(),
            ),
        },
        (Message::SignInCode { code, new_account }, De) => Parts {
            subject: format!("{code} ist dein OpenRadlr-Code"),
            preheader: "Dein Code gilt 10 Minuten.".into(),
            heading: if *new_account { "Willkommen bei OpenRadlr" } else { "Bei OpenRadlr anmelden" }.into(),
            paragraphs: vec![if *new_account {
                "Gib diesen Code ein, um dein Konto anzulegen und deine Fahrten zu sichern:"
            } else {
                "Gib diesen Code ein, um dich anzumelden:"
            }
            .into()],
            code: Some(code.clone()),
            button: None,
            note: Some(
                "Der Code gilt 10 Minuten. Nicht angefordert? Dann ignoriere diese Mail: Ohne den Code kann sich niemand anmelden."
                    .into(),
            ),
        },
        (Message::PasskeyAdded { name, added_s }, En) => Parts {
            subject: "A passkey was added to your OpenRadlr account".into(),
            preheader: format!("“{name}” can now sign you in."),
            heading: "New passkey added".into(),
            paragraphs: vec![format!(
                "The passkey “{name}” was added to your account on {}. From now on it can sign you in.",
                date(*added_s, En)
            )],
            code: None,
            button: Some("Open your account".into()),
            note: Some("Wasn't you? Sign in with a code and remove the passkey under Profile → Account.".into()),
        },
        (Message::PasskeyAdded { name, added_s }, De) => Parts {
            subject: "Neuer Passkey für dein OpenRadlr-Konto".into(),
            preheader: format!("„{name}“ kann dich jetzt anmelden."),
            heading: "Neuer Passkey hinzugefügt".into(),
            paragraphs: vec![format!(
                "Der Passkey „{name}“ wurde am {} zu deinem Konto hinzugefügt. Ab jetzt kannst du dich damit anmelden.",
                date(*added_s, De)
            )],
            code: None,
            button: Some("Konto öffnen".into()),
            note: Some(
                "Das warst nicht du? Melde dich mit einem Code an und entferne den Passkey unter Profil → Konto.".into(),
            ),
        },
        (Message::AccountDeleted, En) => Parts {
            subject: "Your OpenRadlr account was deleted".into(),
            preheader: "Your account and its backups are gone.".into(),
            heading: "Account deleted".into(),
            paragraphs: vec![
                "Your account and everything backed up in it have been deleted. Rides on your devices stay where they are."
                    .into(),
                "You can make a new account at any time: just sign in with this address again.".into(),
            ],
            code: None,
            button: None,
            note: None,
        },
        (Message::AccountDeleted, De) => Parts {
            subject: "Dein OpenRadlr-Konto wurde gelöscht".into(),
            preheader: "Dein Konto und seine Sicherungen sind gelöscht.".into(),
            heading: "Konto gelöscht".into(),
            paragraphs: vec![
                "Dein Konto und alles darin Gesicherte wurden gelöscht. Fahrten auf deinen Geräten bleiben, wo sie sind."
                    .into(),
                "Du kannst jederzeit ein neues Konto anlegen: Melde dich einfach wieder mit dieser Adresse an.".into(),
            ],
            code: None,
            button: None,
            note: None,
        },
    }
}

fn footer(site: &str, language: Language) -> (String, String) {
    let host = site.split("://").nth(1).unwrap_or(site);
    match language {
        Language::English => (
            format!("You get this mail because this address was used to sign in at {host}."),
            "OpenRadlr: open-source indoor cycling with friends and bots".into(),
        ),
        Language::German => (
            format!("Du bekommst diese Mail, weil diese Adresse auf {host} zur Anmeldung verwendet wurde."),
            "OpenRadlr: Open-Source-Indoor-Cycling mit Freunden und Bots".into(),
        ),
    }
}

/// Renders `message` for the site at `site` (its origin, e.g. `https://app.openradlr.com`).
pub fn render(message: &Message, language: Language, site: &str) -> Rendered {
    let parts = parts(message, language);
    let (why, tagline) = footer(site, language);
    Rendered {
        text: text(&parts, site, &why),
        html: html(&parts, site, &why, &tagline, language),
        subject: parts.subject,
        code: parts.code,
    }
}

fn text(parts: &Parts, site: &str, why: &str) -> String {
    let mut out = format!("{}\n\n", parts.heading);
    for paragraph in &parts.paragraphs {
        out.push_str(paragraph);
        out.push_str("\n\n");
    }
    if let Some(code) = &parts.code {
        out.push_str(&format!("    {code}\n\n"));
    }
    if let Some(button) = &parts.button {
        out.push_str(&format!("{button}: {site}\n\n"));
    }
    if let Some(note) = &parts.note {
        out.push_str(note);
        out.push_str("\n\n");
    }
    out.push_str(&format!("-- \n{why}\n{site}\n"));
    out
}

fn html(parts: &Parts, site: &str, why: &str, tagline: &str, language: Language) -> String {
    let lang = match language {
        Language::English => "en",
        Language::German => "de",
    };
    let site_e = escape(site);
    let paragraphs: String = parts
        .paragraphs
        .iter()
        .map(|p| {
            format!(
                r#"<p class="text" style="margin:0 0 16px;font-size:16px;line-height:24px;color:#2b3038;">{}</p>"#,
                escape(p)
            )
        })
        .collect();
    let code = parts.code.as_deref().map_or_else(String::new, |code| {
        format!(
            r#"<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td align="center" class="code" style="background:#fff4ea;border:1px solid #ffd2ad;border-radius:12px;padding:20px 12px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:36px;line-height:40px;font-weight:700;letter-spacing:10px;color:#1b1f24;">{}</td></tr></table>"#,
            escape(code)
        )
    });
    let button = parts.button.as_deref().map_or_else(String::new, |label| {
        format!(
            r#"<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:10px;background:#ff7a1a;"><a href="{site_e}" style="display:inline-block;padding:12px 22px;font-size:16px;font-weight:700;color:#1a0d02;text-decoration:none;border-radius:10px;">{}</a></td></tr></table>"#,
            escape(label)
        )
    });
    let note = parts.note.as_deref().map_or_else(String::new, |note| {
        format!(
            r#"<p class="muted" style="margin:0;font-size:14px;line-height:21px;color:#6b7280;">{}</p>"#,
            escape(note)
        )
    });
    format!(
        r#"<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{subject}</title>
<style>
  @media (prefers-color-scheme: dark) {{
    .page {{ background:#0f1216 !important; }}
    .card {{ background:#171b21 !important; border-color:#2a313b !important; }}
    .heading, .text, .code {{ color:#e8ecf1 !important; }}
    .muted, .footer {{ color:#8a94a3 !important; }}
    .code {{ background:#2a1d12 !important; border-color:#5a3a1f !important; }}
  }}
  @media (max-width: 600px) {{
    .card-cell {{ padding:28px 22px !important; }}
  }}
</style>
</head>
<body class="page" style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="page" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 20px;">
      <a href="{site_e}" style="text-decoration:none;"><img src="cid:{cid}" width="56" height="45" alt="" style="vertical-align:middle;border:0;"><span style="vertical-align:middle;margin-left:10px;font-size:22px;font-weight:800;font-style:italic;color:#ff7a1a;">OpenRadlr</span></a>
    </td></tr>
    <tr><td class="card" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="card-cell" style="padding:36px 40px;">
        <h1 class="heading" style="margin:0 0 16px;font-size:24px;line-height:30px;color:#1b1f24;">{heading}</h1>
        {paragraphs}{code}{button}{note}
      </td></tr></table>
    </td></tr>
    <tr><td class="footer" style="padding:20px 8px 0;font-size:12px;line-height:18px;color:#8a94a3;text-align:center;">
      {why}<br><a href="{site_e}" style="color:#8a94a3;">{tagline}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
"#,
        subject = escape(&parts.subject),
        preheader = escape(&parts.preheader),
        heading = escape(&parts.heading),
        cid = BRAND_MARK_CID,
        why = escape(why),
        tagline = escape(tagline),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SITE: &str = "https://app.openradlr.com";

    fn code_mail(new_account: bool, language: Language) -> Rendered {
        render(
            &Message::SignInCode {
                code: "042137".into(),
                new_account,
            },
            language,
            SITE,
        )
    }

    #[test]
    fn a_code_mail_has_the_code_in_subject_text_and_html() {
        let mail = code_mail(false, Language::English);
        assert!(mail.subject.starts_with("042137"));
        assert!(mail.text.contains("    042137\n"));
        assert!(mail.html.contains(">042137</td>"));
        assert_eq!(mail.code.as_deref(), Some("042137"));
    }

    #[test]
    fn a_new_address_is_welcomed_and_a_known_one_signed_in() {
        assert!(code_mail(true, Language::English)
            .text
            .starts_with("Welcome to OpenRadlr"));
        assert!(code_mail(false, Language::English)
            .text
            .starts_with("Sign in to OpenRadlr"));
        assert!(code_mail(true, Language::German)
            .text
            .starts_with("Willkommen bei OpenRadlr"));
    }

    #[test]
    fn the_html_shows_the_inline_brand_mark_and_links_to_the_site() {
        let html = code_mail(false, Language::German).html;
        assert!(html.contains(r#"src="cid:brand-mark""#));
        assert!(html.contains(r#"href="https://app.openradlr.com""#));
        assert!(html.contains(r#"<html lang="de">"#));
    }

    #[test]
    fn a_passkey_name_is_escaped_in_the_html_and_kept_in_the_text() {
        let mail = render(
            &Message::PasskeyAdded {
                name: "<b>Laptop</b>".into(),
                added_s: 1_795_540_000,
            },
            Language::English,
            SITE,
        );
        assert!(!mail.html.contains("<b>Laptop"));
        assert!(mail.html.contains("&lt;b&gt;Laptop"));
        assert!(mail.text.contains("“<b>Laptop</b>”"));
        assert_eq!(mail.code, None);
    }

    #[test]
    fn dates_are_written_the_riders_way() {
        // 2026-11-24 15:00 UTC
        assert_eq!(date(1_795_532_400, Language::English), "24 Nov 2026");
        assert_eq!(date(1_795_532_400, Language::German), "24.11.2026");
        assert_eq!(date(0, Language::German), "01.01.1970");
        assert_eq!(date(951_782_400, Language::English), "29 Feb 2000");
    }

    #[test]
    fn the_deletion_mail_needs_no_button_or_code() {
        let mail = render(&Message::AccountDeleted, Language::German, SITE);
        assert_eq!(mail.subject, "Dein OpenRadlr-Konto wurde gelöscht");
        assert!(!mail
            .html
            .contains("<a href=\"https://app.openradlr.com\" style=\"display:inline-block"));
    }

    #[test]
    fn the_footer_names_the_site() {
        assert!(code_mail(false, Language::English)
            .text
            .contains("at app.openradlr.com."));
    }
}
