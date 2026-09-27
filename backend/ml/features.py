MATERIALS = ("mobile", "laptop", "tv", "battery", "printer", "other")
CONDITION_SCORE = {"poor": 0.0, "fair": 1.0, "good": 2.0, "excellent": 3.0}


def value_features(material: str, weight_kg: float, condition: str, latitude: float | None, longitude: float | None) -> list[float]:
    if material not in MATERIALS or condition not in CONDITION_SCORE:
        raise ValueError("Unsupported training feature value.")
    return [1.0 if material == item else 0.0 for item in MATERIALS] + [
        float(weight_kg), CONDITION_SCORE[condition], float(latitude or 0), float(longitude or 0),
    ]
