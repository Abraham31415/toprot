import csv
import io

from .models import GenerateRequest

REDCAP_HEADERS = [
    "Variable / Field Name",
    "Form Name",
    "Section Header",
    "Field Type",
    "Field Label",
    "Choices, Calculations, OR Slider Labels",
    "Field Note",
    "Text Validation Type OR Show Slider Number",
    "Text Validation Min",
    "Text Validation Max",
    "Identifier?",
    "Branching Logic (Show field only if...)",
    "Required Field?",
]

# REDCap field type + validation for each ToProt variable type. Anything with
# value labels becomes radio regardless of this default.
DEFAULT_FIELD_TYPE = {
    "continuous": ("text", "number"),
    "categorical": ("text", ""),
    "binary": ("yesno", ""),
    "ordinal": ("text", ""),
    "date": ("text", "date_ymd"),
    "text": ("text", ""),
}


def build_redcap_csv(req: GenerateRequest) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(REDCAP_HEADERS)

    for v in req.variables:
        field_type, validation = DEFAULT_FIELD_TYPE.get(v.variable_type, ("text", ""))
        choices = ""
        if v.value_labels:
            field_type = "radio"
            choices = " | ".join(f"{code}, {label}" for code, label in v.value_labels.items())

        writer.writerow(
            [
                v.variable_slug,
                "study_data",
                "",
                field_type,
                v.variable_name,
                choices,
                v.description or "",
                validation,
                "",
                "",
                "",
                "",
                "",
            ]
        )

    return buffer.getvalue()
