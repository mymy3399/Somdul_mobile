import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger("uvicorn.error")


def is_email_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD and settings.SMTP_FROM)


def send_reminder_email(to_email: str, to_name: str, items: list[str]) -> None:
    if not items:
        return
    if not is_email_configured():
        logger.info(f"[notifier] SMTP not configured — skipping reminder email to {to_email}")
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

    msg = MIMEMultipart()
    msg["Subject"] = "Somdul: รายการที่ใกล้ถึงกำหนดชำระของคุณ"
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email
    msg.attach(MIMEText(body, "plain", "utf-8"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM, [to_email], msg.as_string())
        logger.info(f"[notifier] Sent reminder email to {to_email}")
    except Exception as e:
        logger.error(f"[notifier] Failed to send reminder email to {to_email}: {e}")
