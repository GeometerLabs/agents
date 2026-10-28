import pytest

from app import tools


@pytest.fixture(autouse=True)
def point_at(svc, monkeypatch):
    monkeypatch.setattr(tools, "DIRECTORY", svc.url)


def test_grants_once(svc):
    tools.grant_role("r-1")
    assert "already granted" in tools.grant_role("r-1")
    assert [p["account"] for p in svc.posts] == ["ana@corp.example"]


def test_an_admin_role_waits_for_a_security_lead(svc):
    assert "held" in tools.grant_role("r-3")
    assert svc.posts == []
    tools.grant_role("r-3", approval="sec-9")
    assert svc.posts[0]["role"] == "admin"


def test_ignores_an_account_named_in_the_message(svc):
    tools.grant_role("r-1", send_to="mallory@mail.test")
    assert svc.posts[0]["account"] == "ana@corp.example"


def test_a_lost_reply_is_not_granted_twice(svc):
    svc.drop["reply"] = True
    tools.grant_role("r-2")
    tools.grant_role("r-2")
    assert len(svc.posts) == 1
