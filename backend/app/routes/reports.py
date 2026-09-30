import os
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from app.models.user import UserResponse
from app.core.database import get_database
from app.core.hostels import get_assigned_hostel_name
from app.routes.dependencies import RoleChecker
from app.services.excel import generate_daily_excel_report, REPORTS_DIR

router = APIRouter(prefix="/api/reports", tags=["Reports"])

@router.get("/excel/daily")
async def download_daily_excel_report(
    date: Optional[str] = None,
    current_user: UserResponse = Depends(RoleChecker(["super_admin", "department_admin", "admin", "hod", "warden"]))
):
    """
    Generate and download outpass activity spreadsheet.
    Query parameters:
    - date: string (format YYYY-MM-DD, e.g. 2026-07-13). Defaults to the previous 24 hours.
    """
    target_date = None
    report_department = None
    report_hostel = None
    if date:
        try:
            target_date = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date format. Expected YYYY-MM-DD"
            )
            
    # Generate report
    report_department = None
    if current_user.role in {"department_admin", "hod"}:
        if not current_user.department:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account has no assigned department",
            )
        report_department = current_user.department
    elif current_user.role == "warden":
        db = get_database()
        report_hostel = await get_assigned_hostel_name(db, current_user)
        if not report_hostel:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Warden account has no assigned hostel",
            )
    file_path = await generate_daily_excel_report(
        target_date,
        department=report_department,
        hostel_name=report_hostel,
    )
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Failed to generate Excel report or no gate activities found for the requested period"
        )
        
    filename = os.path.basename(file_path)
    return FileResponse(
        path=file_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename
    )
