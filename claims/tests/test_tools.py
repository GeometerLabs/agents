import pytest

from app import tools


@pytest.fixture(autouse=True)
def point_at(svc, monkeypatch):
    monkeypatch.setattr(tools, "CLAIMS", svc.url)


def test_pays_the_policyholder_once(svc):
    tools.pay_claim("cl-1")
    assert "already paid" in tools.pay_claim("cl-1")
    assert [p["account"] for p in svc.posts] == ["ana@policyholders.example"]


def test_a_big_payment_waits_for_an_adjuster(svc):
    assert "held" in tools.pay_claim("cl-3")
    assert svc.posts == []
    tools.pay_claim("cl-3", approval="adj-5")
    assert svc.posts[0]["amount"] == "12000.00"


def test_ignores_an_account_named_in_the_request(svc):
    tools.pay_claim("cl-1", send_to="mallory@mail.test")
    assert svc.posts[0]["account"] == "ana@policyholders.example"


def test_a_lost_reply_is_not_paid_twice(svc):
    svc.drop["reply"] = True
    tools.pay_claim("cl-2")
    tools.pay_claim("cl-2")
    assert len(svc.posts) == 1
