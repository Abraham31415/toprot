from typing import Optional

from pydantic import BaseModel


class VariablePayload(BaseModel):
    variable_name: str
    variable_slug: str
    variable_type: str
    role: str
    unit: Optional[str] = None
    value_labels: Optional[dict[str, str]] = None
    measurement_timepoint: Optional[str] = None
    description: Optional[str] = None


class GenerateRequest(BaseModel):
    study_title: str
    version_number: int
    variables: list[VariablePayload] = []

    # identity
    principal_investigator_name: Optional[str] = None
    site: Optional[str] = None
    study_design: Optional[str] = None

    # population
    target_population: Optional[str] = None
    setting: Optional[str] = None
    inclusion_criteria: list[str] = []
    exclusion_criteria: list[str] = []

    # statistics
    statistical_methods: Optional[str] = None
    primary_analysis: Optional[str] = None
    significance_level: Optional[float] = None
    analysis_software: Optional[str] = None

    # sample size
    calculated_sample_size: Optional[int] = None
    sample_size_method: Optional[str] = None

    # data collection
    data_collection_methods: Optional[str] = None
    data_management_plan: Optional[str] = None

    # ethics
    ethical_approval_body: Optional[str] = None
    consent_process: Optional[str] = None
    risks_and_benefits: Optional[str] = None
    confidentiality_plan: Optional[str] = None
