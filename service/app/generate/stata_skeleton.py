from datetime import date
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from .models import GenerateRequest, VariablePayload

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
_env = Environment(loader=FileSystemLoader(TEMPLATES_DIR), trim_blocks=True, lstrip_blocks=True)


def label_define_clause(v: VariablePayload) -> str:
    if not v.value_labels:
        return ""
    return " ".join(f'{code} "{text}"' for code, text in v.value_labels.items())


def build_stata_skeleton(req: GenerateRequest) -> str:
    template = _env.get_template("stata_skeleton.do.jinja")
    variables = [
        {"v": v, "label_define": label_define_clause(v)} for v in req.variables
    ]
    return template.render(
        study_title=req.study_title,
        version_number=req.version_number,
        generated_date=date.today().isoformat(),
        variables=variables,
        statistical_methods=req.statistical_methods,
        primary_analysis=req.primary_analysis,
        significance_level=req.significance_level,
    )
