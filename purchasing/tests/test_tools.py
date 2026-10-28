import pytest

from app import tools


@pytest.fixture(autouse=True)
def point_at(svc, monkeypatch):
    monkeypatch.setattr(tools, "PROCUREMENT", svc.url)


def test_orders_once_per_request(svc):
    tools.place_order("pr-1")
    assert "already ordered" in tools.place_order("pr-1")
    assert len(svc.posts) == 1 and svc.posts[0]["supplier"] == "acme-supplies"


def test_an_order_above_the_buyers_limit_waits_for_the_buyer(svc):
    assert "held" in tools.place_order("pr-3")
    assert svc.posts == []
    tools.place_order("pr-3", approval="buyer-ok-1")
    assert svc.posts[0]["amount"] == "2400.00"


def test_an_order_at_the_limit_goes_through(svc):
    tools.place_order("pr-2")
    assert len(svc.posts) == 1


def test_a_lost_reply_is_not_ordered_twice(svc):
    svc.drop["reply"] = True
    tools.place_order("pr-1")
    tools.place_order("pr-1")
    assert len(svc.posts) == 1
