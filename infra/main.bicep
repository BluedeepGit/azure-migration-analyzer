param location string = resourceGroup().location
param appName string = 'app-analyze-itan-${uniqueString(resourceGroup().id)}' // Genera nome unico stabile
param planName string = 'plan-analyze-itan'

// 1. App Service Plan
resource appServicePlan 'Microsoft.Web/serverfarms@2022-03-01' = {
  name: planName
  location: location
  sku: {
    name: 'B1' // Cambia in F1 se vuoi gratis, B1 per produzione base
    tier: 'Basic'
  }
  kind: 'linux'
  properties: {
    reserved: true // Obbligatorio per Linux
  }
}

// 2. Web App
resource webApp 'Microsoft.Web/sites@2022-03-01' = {
  name: appName
  location: location
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      appCommandLine: 'node dist/index.js' // Comando di avvio custom
    }
  }
  identity: {
    type: 'SystemAssigned' // Crea la Managed Identity
  }
}

// Output utili per la pipeline
output webAppName string = webApp.name
output webAppHostName string = webApp.properties.defaultHostName
output principalId string = webApp.identity.principalId