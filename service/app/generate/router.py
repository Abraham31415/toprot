from fastapi import APIRouter
from fastapi.responses import PlainTextResponse, Response

from .consent_form import build_consent_form_docx
from .data_dictionary import build_data_dictionary_docx
from .deviation_report import DeviationReportRequest, build_deviation_report_docx
from .ethics_package import build_ethics_package_docx
from .kobo_form import build_kobo_form_xlsx
from .methods_paragraph import build_methods_paragraph_docx
from .models import GenerateRequest
from .redcap_form import build_redcap_csv
from .stata_skeleton import build_stata_skeleton
from .table_shells import build_table_shells_docx

router = APIRouter(prefix="/generate", tags=["generate"])

DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.post("/data-dictionary")
def generate_data_dictionary(req: GenerateRequest):
    content = build_data_dictionary_docx(req)
    return Response(
        content=content,
        media_type=DOCX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="data_dictionary.docx"'},
    )


@router.post("/stata-skeleton")
def generate_stata_skeleton(req: GenerateRequest):
    content = build_stata_skeleton(req)
    return PlainTextResponse(
        content=content,
        media_type="text/plain",
        headers={"Content-Disposition": 'attachment; filename="stata_skeleton.do"'},
    )


@router.post("/deviation-report")
def generate_deviation_report(req: DeviationReportRequest):
    content = build_deviation_report_docx(req)
    return Response(
        content=content,
        media_type=DOCX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="deviation_report.docx"'},
    )


@router.post("/kobo-form")
def generate_kobo_form(req: GenerateRequest):
    content = build_kobo_form_xlsx(req)
    return Response(
        content=content,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="kobo_form.xlsx"'},
    )


@router.post("/redcap-form")
def generate_redcap_form(req: GenerateRequest):
    content = build_redcap_csv(req)
    return PlainTextResponse(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="redcap_data_dictionary.csv"'},
    )


@router.post("/table-shells")
def generate_table_shells(req: GenerateRequest):
    content = build_table_shells_docx(req)
    return Response(
        content=content,
        media_type=DOCX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="table_shells.docx"'},
    )


@router.post("/methods-paragraph")
def generate_methods_paragraph(req: GenerateRequest):
    content = build_methods_paragraph_docx(req)
    return Response(
        content=content,
        media_type=DOCX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="methods_paragraph.docx"'},
    )


@router.post("/ethics-package")
def generate_ethics_package(req: GenerateRequest):
    content = build_ethics_package_docx(req)
    return Response(
        content=content,
        media_type=DOCX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="ethics_package.docx"'},
    )


@router.post("/consent-form")
def generate_consent_form(req: GenerateRequest):
    content = build_consent_form_docx(req)
    return Response(
        content=content,
        media_type=DOCX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="consent_form.docx"'},
    )
