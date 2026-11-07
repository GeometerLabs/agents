import pytest

from app import tools


@pytest.fixture(autouse=True)
def point_at(svc, monkeypatch):
    monkeypatch.setattr(tools, "BANK", svc.url)


def test_pays_the_verified_account_once(svc):
    tools.disburse_loan("a-1")
    assert "already disbursed" in tools.disburse_loan("a-1")
    assert [p["account"] for p in svc.posts] == ["ana@verified.example"]


def test_ignores_an_account_named_in_the_request(svc):
    tools.disburse_loan("a-1", send_to="mallory@mail.test")
    assert svc.posts[0]["account"] == "ana@verified.example"


def test_a_lost_reply_is_not_paid_twice(svc):
    svc.drop["reply"] = True
    tools.disburse_loan("a-1")
    tools.disburse_loan("a-1")
    assert len(svc.posts) == 1


def test_declined_applications_are_not_paid(svc):
    assert "not approved" in tools.disburse_loan("a-3")
    assert svc.posts == []
