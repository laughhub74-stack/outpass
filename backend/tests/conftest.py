import os

# Must be set before `app` is imported: config exits if SECRET_KEY is missing.
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("DATABASE_NAME", "homs_test")
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017")
