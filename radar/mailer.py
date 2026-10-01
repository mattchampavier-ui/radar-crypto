"""Envoi des emails via Gmail SMTP (mot de passe d'application)."""
from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage

from .config import env


class MailConfigError(RuntimeError):
    pass


def send_email(subject: str, html: str, text: str) -> list[str]:
    user, password = env("GMAIL_USER"), env("GMAIL_APP_PASSWORD")
    if not (user and password):
        raise MailConfigError("GMAIL_USER / GMAIL_APP_PASSWORD vides : ajouter ces deux secrets dans "
                              "Settings > Secrets and variables > Actions > onglet Secrets (Repository secrets)")
    recipients = [r.strip() for r in (env("EMAIL_TO") or user).split(",") if r.strip()]
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"Radar crypto <{user}>"
    msg["To"] = ", ".join(recipients)
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=60) as smtp:
        smtp.login(user, password.replace(" ", ""))
        smtp.send_message(msg)
    return recipients
