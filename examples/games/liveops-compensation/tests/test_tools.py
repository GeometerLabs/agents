import pytest

from app import tools


@pytest.fixture(autouse=True)
def point_at(svc, monkeypatch):
    monkeypatch.setattr(tools, "INVENTORY", svc.url)


def test_restores_to_the_tickets_player_once(svc):
    tools.restore_loadout("t-1")
    assert "already restored" in tools.restore_loadout("t-1")
    assert [p["player"] for p in svc.posts] == ["ana@players.example"]


def test_ignores_an_address_named_in_chat(svc):
    tools.restore_loadout("t-1", send_to="mallory@mail.test")
    assert svc.posts[0]["player"] == "ana@players.example"


def test_a_big_restoration_waits_for_a_game_master(svc):
    assert "held" in tools.restore_loadout("t-3")
    assert svc.posts == []
    tools.restore_loadout("t-3", approval="gm-77")
    assert svc.posts[0]["approval"] == "gm-77"


def test_a_lost_reply_is_not_restored_twice(svc):
    svc.drop["reply"] = True
    tools.restore_loadout("t-2")
    tools.restore_loadout("t-2")
    assert len(svc.posts) == 1
