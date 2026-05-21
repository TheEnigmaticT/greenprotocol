def convert_to_kg(value, unit):
    multipliers = {
        'kg': 1,
        'g': 0.001,
        'mg': 0.000001,
        't': 1000,
        'lb': 0.453592,
        'oz': 0.0283495
    }
    return value * multipliers.get(unit.lower(), 1)

def convert_to_mol(value, unit, mw):
    if unit.lower() == 'mol': return value
    if unit.lower() == 'mmol': return value / 1000
    # If mass unit, convert to g then divide by MW
    mass_g = convert_to_kg(value, unit) * 1000
    return mass_g / mw
