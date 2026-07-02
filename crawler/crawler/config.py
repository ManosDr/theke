import os

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://theke:changeme@localhost:5432/theke"
).replace("postgresql+psycopg://", "postgresql://")
