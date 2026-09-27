import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["APP_SECRET"] = "test-only-secret-change-me"
os.environ["SEED_DEMO"] = "true"
os.environ["APP_ENV"] = "test"
