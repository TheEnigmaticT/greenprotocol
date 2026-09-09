export interface ChemistryServiceEnvironment {
  CHEMISTRY_SERVICE_URL?: string
  CHEMISTRY_SERVICE_TOKEN?: string
}

export interface ChemistryServiceConfig {
  url: string
  token: string
}

function requiredEnvironmentValue(
  environment: ChemistryServiceEnvironment,
  name: keyof ChemistryServiceEnvironment,
): string {
  const value = environment[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

export function getChemistryServiceConfig(
  environment: ChemistryServiceEnvironment = process.env as ChemistryServiceEnvironment,
): ChemistryServiceConfig {
  const url = requiredEnvironmentValue(environment, 'CHEMISTRY_SERVICE_URL').replace(/\/+$/, '')
  const token = requiredEnvironmentValue(environment, 'CHEMISTRY_SERVICE_TOKEN')

  return { url, token }
}
