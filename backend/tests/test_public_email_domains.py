from __future__ import annotations

import pytest

from backend.public_email_domains import is_public_domain


@pytest.mark.parametrize(
    "domain",
    [
        "gmail.com",
        "outlook.com",
        "hotmail.com",
        "icloud.com",
        "yahoo.com",
        "libero.it",
        "virgilio.it",
        "tin.it",
        "alice.it",
        "proton.me",
        "aol.com",
        "live.com",
        "gmx.com",
    ],
)
def test_known_personal_domains_are_public(domain):
    assert is_public_domain(domain) is True


@pytest.mark.parametrize("domain", ["digitalmens.it", "acmecorp.com", "example-company.io"])
def test_company_like_domains_are_not_public(domain):
    assert is_public_domain(domain) is False


def test_domain_matching_is_case_insensitive():
    assert is_public_domain("GMAIL.COM") is True
