def test_register_and_login(client):
    res = client.post(
        "/api/auth/register",
        json={"name": "Alice", "email": "alice@example.com", "password": "Passw0rd!"},
    )
    assert res.status_code == 201

    res = client.post(
        "/api/auth/login",
        data={"username": "alice@example.com", "password": "Passw0rd!"},
    )
    assert res.status_code == 200
    assert "access_token" in res.json()


def test_register_rejects_weak_password(client):
    res = client.post(
        "/api/auth/register",
        json={"name": "Bob", "email": "bob@example.com", "password": "short"},
    )
    assert res.status_code == 400


def test_login_rejects_wrong_password(client):
    client.post(
        "/api/auth/register",
        json={"name": "Carol", "email": "carol@example.com", "password": "Passw0rd!"},
    )
    res = client.post(
        "/api/auth/login",
        data={"username": "carol@example.com", "password": "WrongPass1!"},
    )
    assert res.status_code == 400


def test_reset_requires_authentication(client):
    # Regression test: /api/auth/reset used to be callable by anyone,
    # anonymously, and would wipe/reseed the demo account.
    res = client.post("/api/auth/reset")
    assert res.status_code == 401


def test_reset_works_when_authenticated(client, auth_headers):
    headers = auth_headers(email="dave@example.com")
    res = client.post("/api/auth/reset", headers=headers)
    assert res.status_code == 200


def test_login_is_rate_limited(client):
    for _ in range(10):
        client.post(
            "/api/auth/login",
            data={"username": "nobody@example.com", "password": "WrongPass1!"},
        )
    res = client.post(
        "/api/auth/login",
        data={"username": "nobody@example.com", "password": "WrongPass1!"},
    )
    assert res.status_code == 429
