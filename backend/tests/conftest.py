import pytest
from fastapi.testclient import TestClient
from main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app, cookies={}) as c:
        yield c
