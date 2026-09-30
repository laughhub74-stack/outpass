import os
import logging
import asyncio
import re
from datetime import datetime, timedelta
import pandas as pd
from bson import ObjectId
from app.core.database import get_database
from app.core.hostels import hostel_name_filter

logger = logging.getLogger("homs_excel")

REPORTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "reports")

def ensure_reports_directory():
    if not os.path.exists(REPORTS_DIR):
        os.makedirs(REPORTS_DIR)
        logger.info(f"Created reports directory at: {REPORTS_DIR}")

def _write_excel_sync(df: "pd.DataFrame", file_path: str):
    """Blocking pandas/openpyxl I/O - must always run off the event loop."""
    with pd.ExcelWriter(file_path, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Outpass Activity")
        worksheet = writer.sheets["Outpass Activity"]
        for col in worksheet.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = col[0].column_letter
            worksheet.column_dimensions[col_letter].width = max(max_len + 3, 12)

async def generate_daily_excel_report(
    target_date: datetime = None,
    department: str = None,
    hostel_name: str = None,
) -> str:
    """
    Generates an Excel spreadsheet containing all outpass events within the 24-hour range of target_date.
    If target_date is not specified, defaults to the previous 24 hours (yesterday).
    Columns: Student Name, Roll Number, Destination, Reason, OUT DateTime, IN DateTime, Status.
    Returns the absolute path to the generated Excel file.
    """
    try:
        ensure_reports_directory()
        
        if target_date is None:
            # Previous 24h
            end_time = datetime.utcnow()
            start_time = end_time - timedelta(days=1)
        else:
            # 24h around target_date
            start_time = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
            end_time = start_time + timedelta(days=1)
            
        db = get_database()
        
        # Query outpasses that marked exit or entry within this range
        query = {
            "$or": [
                {"exit_time": {"$gte": start_time, "$lt": end_time}},
                {"entry_time": {"$gte": start_time, "$lt": end_time}}
            ]
        }
        if department:
            query["department"] = department
        if hostel_name is not None:
            hostel_filter = hostel_name_filter(hostel_name)
            query["hostel_name"] = hostel_filter or {"$in": []}
        
        cursor = db.outpasses.find(query)
        outpasses = await cursor.to_list(length=None)
        
        data_rows = []
        for op in outpasses:
            data_rows.append({
                "Student Name": op.get("student_name", "N/A"),
                "Roll Number": op.get("roll_number", "N/A"),
                "Destination": op.get("destination", ""),
                "Reason": op.get("reason", ""),
                "OUT DateTime": op.get("exit_time").strftime("%Y-%m-%d %H:%M:%S") if op.get("exit_time") else "Not Exited Yet",
                "IN DateTime": op.get("entry_time").strftime("%Y-%m-%d %H:%M:%S") if op.get("entry_time") else "Not Returned Yet",
                "Status": op.get("status", "N/A")
            })
            
        df = pd.DataFrame(data_rows)
        
        if df.empty:
            # Create a mock DataFrame with correct columns if empty
            df = pd.DataFrame(columns=[
                "Student Name", "Roll Number", "Destination", "Reason", "OUT DateTime", "IN DateTime", "Status"
            ])
            
        date_str = (target_date or (datetime.utcnow() - timedelta(days=1))).strftime("%Y-%m-%d")
        report_scope = department or hostel_name
        scope_suffix = f"_{re.sub(r'[^A-Za-z0-9_-]+', '_', report_scope)}" if report_scope else ""
        filename = f"outpass_activity_{date_str}{scope_suffix}.xlsx"
        file_path = os.path.join(REPORTS_DIR, filename)
        
        # Run the blocking pandas/openpyxl write in a thread so it never
        # blocks the event loop (this used to run inline and would stall
        # every other in-flight request while the file was written).
        await asyncio.to_thread(_write_excel_sync, df, file_path)

        logger.info(f"Excel report generated successfully at: {file_path}")
        return file_path
        
    except Exception as e:
        logger.error(f"Failed to generate Excel report: {str(e)}")
        # Return none or raise, but we handle gracefully
        return ""
