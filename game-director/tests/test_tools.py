import pytest

from app import tools


@pytest.fixture(autouse=True)
def point_at(svc, monkeypatch):
    monkeypatch.setattr(tools, "WORLD", svc.url)


def test_a_spawn_is_applied_once_per_event(svc):
    tools.spawn_resource("ev-1", "iron-ore", 40)
    assert "already applied" in tools.spawn_resource("ev-1", "iron-ore", 40)
    assert len(svc.posts) == 1


def test_a_big_spawn_waits_for_approval(svc):
    assert "held" in tools.spawn_resource("ev-2", "dragon-egg", 250)
    assert svc.posts == []
    tools.spawn_resource("ev-2", "dragon-egg", 250, approval="gm-1")
    assert svc.posts[0]["count"] == 250


def test_prices_outside_the_bounds_are_refused(svc):
    assert "refused" in tools.set_price("ev-4", "iron-sword", "9000.00")
    assert "refused" in tools.set_price("ev-4", "iron-sword", "0.50")
    assert svc.posts == []


def test_a_price_in_bounds_is_set_once(svc):
    tools.set_price("ev-3", "health-potion", "12")
    assert "already applied" in tools.set_price("ev-3", "health-potion", "12")
    assert svc.posts == [{"item": "health-potion", "price": "12.00"}]


def test_a_lost_reply_is_not_applied_twice(svc):
    svc.drop["reply"] = True
    tools.spawn_resource("ev-1", "iron-ore", 40)
    tools.spawn_resource("ev-1", "iron-ore", 40)
    assert len(svc.posts) == 1
