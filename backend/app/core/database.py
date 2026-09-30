import logging
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings

logger = logging.getLogger("homs_db")

class Database:
    def __init__(self):
        self._clients = {}
        self._dbs = {}
        self.client = None
        self.db = None

    def get_db(self):
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return self.db
        
        if loop not in self._clients:
            logger.info(f"Creating MongoDB client for event loop {id(loop)}")
            client = AsyncIOMotorClient(settings.MONGODB_URI)
            db = client[settings.DATABASE_NAME]
            self._clients[loop] = client
            self._dbs[loop] = db
            # Set default fallback references
            self.client = client
            self.db = db
        return self._dbs[loop]

db_instance = Database()

async def connect_to_mongo():
    logger.info("Connecting to MongoDB...")
    # Initialize for the current loop
    db = db_instance.get_db()
    
    # Initialize indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("roll_number", unique=True, sparse=True)
    await db.users.create_index([("name", 1), ("_id", 1)])
    await db.users.create_index([("department", 1), ("name", 1), ("_id", 1)])
    qr_token_index_name = "qr_token_unique_string"
    qr_token_partial_filter = {"qr_token": {"$type": "string"}}
    outpass_indexes = await db.outpasses.index_information()
    for index_name, index_spec in outpass_indexes.items():
        if index_spec.get("key") != [("qr_token", 1)]:
            continue
        if (
            index_name == qr_token_index_name
            and index_spec.get("unique")
            and index_spec.get("partialFilterExpression") == qr_token_partial_filter
        ):
            continue
        await db.outpasses.drop_index(index_name)
    await db.outpasses.create_index(
        "qr_token",
        name=qr_token_index_name,
        unique=True,
        partialFilterExpression=qr_token_partial_filter,
    )
    await db.outpasses.create_index([("student_id", 1), ("created_at", -1)])
    await db.outpasses.create_index([("department", 1), ("created_at", -1)])
    await db.outpasses.create_index([("status", 1), ("created_at", -1)])
    await db.audit_logs.create_index([("timestamp", -1)])
    
    logger.info("Connected to MongoDB & Indexes configured.")

async def close_mongo_connection():
    logger.info("Closing MongoDB connection...")
    try:
        loop = asyncio.get_running_loop()
        if loop in db_instance._clients:
            db_instance._clients[loop].close()
    except RuntimeError:
        if db_instance.client:
            db_instance.client.close()
    logger.info("MongoDB connection closed.")

def get_database():
    return db_instance.get_db()
