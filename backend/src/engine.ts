// backend/src/engine.ts
import tenantRules from './rules.json';
import rgRules from './rules-rg.json';
import subRules from './rules-sub.json';
import regionRules from './rules-region.json';

// Uniamo tutte le regole
const rulesData: any[] = [...tenantRules, ...rgRules, ...subRules, ...regionRules];

export type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';
export type Severity = 'Blocker' | 'Critical' | 'Warning' | 'Info';

export interface AnalyzedResource {
    id: string;
    name: string;
    type: string;
    resourceGroup: string;
    location: string;
    migrationStatus: Severity | 'Ready';
    issues: any[];
}

function getNestedValue(obj: any, path: string): any {
    if (!path) return undefined;
    return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
}

// Funzione di Matching (La stessa che abbiamo perfezionato)
export function evaluateRule(res: any, rule: any, scenario: MigrationScenario): boolean {
    // 1. Filtro Scenario e Ereditarietà
    let scenarioMatch = false;
    if (rule.scenario === scenario) scenarioMatch = true;
    else if (scenario === 'cross-resourcegroup' && rule.scenario === 'cross-subscription') scenarioMatch = true;
    
    if (!scenarioMatch) return false;

    // 2. Matching Tipo Risorsa
    const resType = res.type.toLowerCase();
    const ruleType = rule.resourceType.toLowerCase();
    let typeMatches = false;

    if (ruleType === '*' || ruleType === resType) {
        typeMatches = true;
    } else if (ruleType.endsWith('/*')) {
        const prefix = ruleType.slice(0, -2);
        // Fix: Prefisso esatto seguito da fine stringa o '/'
        if (resType.startsWith(prefix)) {
             if (resType.length === prefix.length || resType[prefix.length] === '/') {
                typeMatches = true;
            }
        }
    }

    if (!typeMatches) return false;

    // 3. Verifica Condizioni
    if (rule.condition) {
        const value = getNestedValue(res, rule.condition.field);
        if (value === undefined || value === null) return false; // Se manca la proprietà, la regola specifica non si applica

        const ruleVal = String(rule.condition.value).toLowerCase();
        const actualVal = String(value).toLowerCase();

        switch (rule.condition.operator) {
            case 'eq': return actualVal === ruleVal;
            case 'neq': return actualVal !== ruleVal;
            case 'contains': return actualVal.includes(ruleVal);
            case 'notEmpty': return Array.isArray(value) && value.length > 0;
            default: return false;
        }
    }

    return true;
}

// Funzione Principale di Analisi
export function analyzeResource(res: any, scenario: MigrationScenario): AnalyzedResource {
    const issues: any[] = [];
    let status: Severity | 'Ready' = 'Ready';

    rulesData.forEach((rule: any) => {
        if (evaluateRule(res, rule, scenario)) {
            issues.push({
                ruleId: rule.id,
                severity: rule.severity,
                message: rule.message,
                impact: rule.impact,
                workaround: rule.workaround,
                downtimeRisk: rule.downtimeRisk,
                refLink: rule.refLink
            });
        }
    });

    if (issues.some(i => i.severity === 'Blocker')) status = 'Blocker';
    else if (issues.some(i => i.severity === 'Critical')) status = 'Critical';
    else if (issues.some(i => i.severity === 'Warning')) status = 'Warning';
    else if (issues.some(i => i.severity === 'Info')) status = 'Info';

    return {
        id: res.id || 'mock-id',
        name: res.name || 'mock-resource',
        type: res.type,
        resourceGroup: res.resourceGroup || 'mock-rg',
        location: res.location || 'westeurope',
        migrationStatus: status,
        issues
    };
}