import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger("uvicorn.error")


def is_email_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD and settings.SMTP_FROM)


def _send_email(to_email: str, subject: str, body: str, log_label: str) -> None:
    if not is_email_configured():
        logger.info(f"[notifier] SMTP not configured — skipping {log_label} email to {to_email}")
        return

    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email
    msg.attach(MIMEText(body, "plain", "utf-8"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM, [to_email], msg.as_string())
        logger.info(f"[notifier] Sent {log_label} email to {to_email}")
    except Exception as e:
        logger.error(f"[notifier] Failed to send {log_label} email to {to_email}: {e}")


def send_reminder_email(to_email: str, to_name: str, items: list[str]) -> None:
    if not items:
        return

    body = "\n".join([
        f"สวัสดีคุณ {to_name},",
        "",
        "รายการที่ใกล้ถึงกำหนดของคุณใน Somdul:",
        "",
        *[f"- {item}" for item in items],
        "",
        "เปิดแอป Somdul เพื่อดูรายละเอียดเพิ่มเติม",
    ])
    _send_email(to_email, "Somdul: รายการที่ใกล้ถึงกำหนดชำระของคุณ", body, "reminder")


def send_password_reset_email(to_email: str, to_name: str, reset_token: str) -> None:
    body = "\n".join([
        f"สวัสดีคุณ {to_name},",
        "",
        "มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี Somdul ของคุณ",
        "นำโค้ดด้านล่างไปกรอกในแอปเพื่อตั้งรหัสผ่านใหม่ (ใช้ได้ภายใน 30 นาที):",
        "",
        reset_token,
        "",
        "หากคุณไม่ได้เป็นผู้ขอ สามารถละเว้นอีเมลนี้ได้ — รหัสผ่านเดิมของคุณจะไม่ถูกเปลี่ยนแปลง",
    ])
    _send_email(to_email, "Somdul: ตั้งรหัสผ่านใหม่", body, "password reset")
