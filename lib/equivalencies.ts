import { ImpactDelta, Equivalency } from './types'

// EPA GHG Equivalencies Calculator conversion factors
// Per 1 metric ton (1000 kg) CO2e
const EPA_FACTORS = {
  milesDriven: 2480,
  gallonsGasoline: 112,
  treeSeedlings: 45.5,
  smartphonesCharged: 122000,
  monthsHomeEnergy: 1.4,
  oneWayFlightsNycLa: 1.1,
}

function scaleEpa(co2eKg: number) {
  const tons = co2eKg / 1000
  return {
    milesDriven: tons * EPA_FACTORS.milesDriven,
    gallonsGasoline: tons * EPA_FACTORS.gallonsGasoline,
    treeSeedlings: tons * EPA_FACTORS.treeSeedlings,
    smartphonesCharged: tons * EPA_FACTORS.smartphonesCharged,
    monthsHomeEnergy: tons * EPA_FACTORS.monthsHomeEnergy,
    oneWayFlightsNycLa: tons * EPA_FACTORS.oneWayFlightsNycLa,
  }
}

function fmt(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  if (n >= 10) return Math.round(n).toLocaleString()
  if (n >= 0.1) return n.toFixed(1)
  if (n >= 0.01) return n.toFixed(2)
  return n.toFixed(3)
}

export function calculateEquivalencies(delta: ImpactDelta): Equivalency[] {
  const results: Equivalency[] = []
  const co2e = delta.co2eSavedKg
  const epa = scaleEpa(co2e)

  // CO2 equivalencies — pick 2 based on scale
  if (co2e > 0) {
    if (co2e < 10) {
      // Small scale
      results.push({
        icon: '🚗',
        value: `${fmt(epa.milesDriven)} miles`,
        description: 'equivalent driving distance saved',
      })
      results.push({
        icon: '⛽',
        value: `${fmt(epa.gallonsGasoline)} gallons`,
        description: 'of gasoline not burned',
      })
    } else if (co2e < 100) {
      // Medium scale
      results.push({
        icon: '🌱',
        value: `${fmt(epa.treeSeedlings)} trees`,
        description: 'worth of carbon absorbed over 10 years',
      })
      results.push({
        icon: '📱',
        value: `${fmt(epa.smartphonesCharged)} phones`,
        description: 'worth of charging saved',
      })
    } else {
      // Large scale
      results.push({
        icon: '✈️',
        value: `${fmt(epa.oneWayFlightsNycLa)} flights`,
        description: 'NYC→LA equivalent emissions prevented',
      })
      results.push({
        icon: '🏠',
        value: `${fmt(epa.monthsHomeEnergy)} months`,
        description: 'of home energy use avoided',
      })
    }
  }

  // Water savings
  if (delta.waterSavedL > 0) {
    const showers = delta.waterSavedL / 65 // avg shower ~65L
    results.push({
      icon: '🚿',
      value: `${fmt(showers)} showers`,
      description: 'worth of water saved',
    })
  }

  // Energy savings
  if (delta.energySavedKwh > 0) {
    const laptopHours = delta.energySavedKwh / 0.05 // laptop ~50W
    results.push({
      icon: '💡',
      value: `${fmt(laptopHours)} hours`,
      description: 'of laptop use equivalent energy saved',
    })
  }

  // Hazardous waste
  if (delta.hazardousWasteEliminatedKg > 0) {
    results.push({
      icon: '☣️',
      value: `${fmt(delta.hazardousWasteEliminatedKg)} kg`,
      description: 'of hazardous waste eliminated',
    })
  }

  // Carcinogens
  if (delta.carcinogensEliminated.length > 0) {
    results.push({
      icon: '🛡️',
      value: `${delta.carcinogensEliminated.length}`,
      description: `suspected carcinogen${delta.carcinogensEliminated.length > 1 ? 's' : ''} eliminated`,
    })
  }

  return results
}
