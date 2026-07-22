def _make_wallet_and_debt(client, headers, total_amount=1000, total_installments=4):
    wallet = client.post(
        "/api/wallets",
        json={"wallet_name": "Cash", "wallet_type": "CASH", "balance": "5000.00"},
        headers=headers,
    ).json()

    debt = client.post(
        "/api/debtors/debts",
        json={
            "debtor_name": "Friend",
            "debt_type": "CASH_LOAN",
            "wallet_id": wallet["id"],
            "total_amount": str(total_amount),
            "total_installments": total_installments,
            "due_day": 15,
        },
        headers=headers,
    ).json()

    return wallet, debt


def test_repay_installments_track_remaining_amount_not_payment_count(client, auth_headers):
    """
    Regression test: repay_debt used to decrement remaining_installments by 1
    per payment regardless of amount, so a debtor paying small/irregular
    amounts could be marked with 0 installments left while still owing money.
    Installment count should instead be derived from remaining_amount.
    """
    headers = auth_headers(email="repay1@example.com")
    _, debt = _make_wallet_and_debt(client, headers, total_amount=1000, total_installments=4)
    # installment value = 1000 / 4 = 250
    assert debt["remaining_installments"] == 4

    receive_wallet = client.post(
        "/api/wallets",
        json={"wallet_name": "Bank", "wallet_type": "BANK_ACCOUNT", "balance": "0.00"},
        headers=headers,
    ).json()

    # Pay less than one full installment: remaining_amount 900 -> still needs
    # ceil(900/250) = 4 installments, NOT 3 (which the old -1-per-payment
    # logic would have produced).
    res = client.post(
        f"/api/debtors/debts/{debt['id']}/repay",
        json={"wallet_id": receive_wallet["id"], "amount": "100.00"},
        headers=headers,
    )
    body = res.json()
    assert res.status_code == 200
    assert body["remaining_amount"] == "900.00"
    assert body["remaining_installments"] == 4
    assert body["status"] == "PARTIALLY_PAID"

    # Pay 700 more: remaining_amount 200 -> ceil(200/250) = 1
    res = client.post(
        f"/api/debtors/debts/{debt['id']}/repay",
        json={"wallet_id": receive_wallet["id"], "amount": "700.00"},
        headers=headers,
    )
    body = res.json()
    assert body["remaining_amount"] == "200.00"
    assert body["remaining_installments"] == 1

    # Pay off the rest fully.
    res = client.post(
        f"/api/debtors/debts/{debt['id']}/repay",
        json={"wallet_id": receive_wallet["id"], "amount": "200.00"},
        headers=headers,
    )
    body = res.json()
    assert body["remaining_amount"] == "0.00"
    assert body["remaining_installments"] == 0
    assert body["status"] == "PAID"


def test_cannot_repay_more_than_remaining(client, auth_headers):
    headers = auth_headers(email="repay2@example.com")
    _, debt = _make_wallet_and_debt(client, headers, total_amount=500, total_installments=1)

    receive_wallet = client.post(
        "/api/wallets",
        json={"wallet_name": "Bank", "wallet_type": "BANK_ACCOUNT", "balance": "0.00"},
        headers=headers,
    ).json()

    res = client.post(
        f"/api/debtors/debts/{debt['id']}/repay",
        json={"wallet_id": receive_wallet["id"], "amount": "999.00"},
        headers=headers,
    )
    assert res.status_code == 400
