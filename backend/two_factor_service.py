from __future__ import annotations

import secrets

# Excludes visually ambiguous characters (0/O, 1/I/L) so codes are easy to
# transcribe by hand if the user writes them down on paper.
RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
RECOVERY_CODE_COUNT = 10

EMAIL_CODE_DIGITS = 6


def generate_email_code() -> str:
    """Cryptographically random 6-digit numeric code, zero-padded."""
    return f"{secrets.randbelow(10 ** EMAIL_CODE_DIGITS):0{EMAIL_CODE_DIGITS}d}"


def generate_recovery_code() -> str:
    raw = "".join(secrets.choice(RECOVERY_CODE_ALPHABET) for _ in range(10))
    return f"{raw[:5]}-{raw[5:]}"


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    return [generate_recovery_code() for _ in range(count)]
