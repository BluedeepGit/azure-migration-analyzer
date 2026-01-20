import tenantRules from './rules.json';
import rgRules from './rules-rg.json';
import subRules from './rules-sub.json';
import regionRules from './rules-region.json';

const rulesData: any[] = [...tenantRules, ...rgRules, ...subRules, ...regionRules];

export type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';
export type Severity = 'Blocker' | 'Critical' | 'Warning' | 'Info' | 'Ready';

export interface AnalyzedResource {
    id: string;
    name: string;
    type: string;
    resourceGroup: string;
    location: string;
    subscriptionId: string;   // Campo obbligatorio
    subscriptionName: string; // Campo obbligatorio
    migrationStatus: Severity | 'Ready';
    issues: any[];
}

function getNestedValue(obj: any, path: string): any {
    if (!path) return undefined;
    return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
}

// ... (la funzione evaluateRule rimane identica a prima) ...
export function evaluateRule(res: any, rule: any, scenario: MigrationScenario): boolean {
    let scenarioMatch = false;
    if (rule.scenario === scenario) scenarioMatch = true;
    else if (scenario === 'cross-resourcegroup' && rule.scenario === 'cross-subscription') scenarioMatch = true;
    
    if (!scenarioMatch) return false;

    const resType = res.type.toLowerCase();
    const ruleType = rule.resourceType.toLowerCase();
    let typeMatches = false;

    if (ruleType === '*' || ruleType === resType) {
        typeMatches = true;
    } else if (ruleType.endsWith('/*')) {
        const prefix = ruleType.slice(0, -2);
        if (resType.startsWith(prefix)) {
             if (resType.length === prefix.length || resType[prefix.length] === '/') {
                typeMatches = true;
            }
        }
    }

    if (!typeMatches) return false;

    if (rule.condition) {
        const value = getNestedValue(res, rule.condition.field);
        if (value === undefined || value === null) return false;

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

// FIX: Ora la funzione costruisce l'intero oggetto e controlla i campi mancanti
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

    // Recupero sicuro dei campi (Azure Graph a volte usa casing diversi?)
    const subId = res.subscriptionId || res.subscriptionid || 'unknown-sub-id';
    const subName = res.subscriptionName || res.subscriptionname || subId; // Fallback su ID se nome manca

    return {
        id: res.id || 'unknown-id',
        name: res.name || 'Unknown Resource',
        type: res.type || 'unknown/type',
        resourceGroup: res.resourceGroup || res.resourcegroup || 'No Resource Group',
        location: res.location || 'unknown',
        subscriptionId: subId,
        subscriptionName: subName,
        migrationStatus: status,
        issues
    };
}