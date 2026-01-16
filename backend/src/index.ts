import express from 'express';
import cors from 'cors';
import path from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

// --- IMPORTIAMO LE 4 BASI DI DATI ---
import tenantRules from './rules.json';        // Cross-Tenant (fatto a mano prima)
import rgRules from './rules-rg.json';         // Generato da PowerShell
import subRules from './rules-sub.json';       // Generato da PowerShell
import regionRules from './rules-region.json'; // Generato da PowerShell

// Uniamo tutto in un unico array
// Usiamo 'any' per evitare problemi di tipo strict durante il merge di JSON diversi
const rulesData: any[] = [...tenantRules, ...rgRules, ...subRules, ...regionRules];

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 8080;

// --- TIPI ---
type MigrationScenario = 'cross-tenant' | 'cross-subscription' | 'cross-resourcegroup' | 'cross-region';
type Severity = 'Blocker' | 'Critical' | 'Warning' | 'Info';

interface RuleDefinition {
    id: string;
    resourceType: string;
    scenario: string;
    condition?: {
        field: string;
        operator: 'eq' | 'neq' | 'contains' | 'notEmpty';
        value?: any;
    };
    severity: Severity;
    message: string;
    impact: string;
    workaround: string;
    downtimeRisk: boolean;
    refLink?: string;
}

interface MigrationIssue {
    ruleId: string;
    severity: Severity;
    message: string;
    impact: string;
    workaround: string;
    downtimeRisk: boolean;
    refLink?: string;
}

interface AnalyzedResource {
    id: string;
    name: string;
    type: string;
    resourceGroup: string;
    location: string;
    migrationStatus: Severity | 'Ready';
    issues: MigrationIssue[];
}

function getNestedValue(obj: any, path: string): any {
    if (!path) return undefined;
    return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
}

function evaluateRule(res: any, rule: RuleDefinition, scenario: MigrationScenario): boolean {
    // 1. Check Scenario
    if (rule.scenario !== scenario) return false;

    const resType = res.type.toLowerCase();
    const ruleType = rule.resourceType.toLowerCase();
    let typeMatches = false;

    // 2. Matching Resource Type
    if (ruleType === '*' || ruleType === resType) {
        typeMatches = true;
    } 
    else if (ruleType.endsWith('/*')) {
        const prefix = ruleType.slice(0, -2);
        // Fix: Ensure strict prefix match (avoid "sql" matching "sqlvirtualmachine")
        if (resType.startsWith(prefix)) {
            if (resType.length === prefix.length || resType[prefix.length] === '/') {
                typeMatches = true;
            }
        }
    }

    if (!typeMatches) return false;

    // 3. Check Conditions
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

function analyzeResource(res: any, scenario: MigrationScenario): AnalyzedResource {
    const issues: MigrationIssue[] = [];
    let status: Severity | 'Ready' = 'Ready';

    rulesData.forEach((rule: RuleDefinition) => {
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
        id: res.id,
        name: res.name,
        type: res.type,
        resourceGroup: res.resourceGroup,
        location: res.location,
        migrationStatus: status,
        issues
    };
}

app.get('/api/analyze', async (req, res) => {
    try {
        const scenario = (req.query.scenario as MigrationScenario) || 'cross-tenant';
        const credential = new DefaultAzureCredential();
        const client = new ResourceGraphClient(credential);

        // Fetch properties essential for conditions (sku, incremental, etc.)
        const query = `
            Resources
            | project name, type, kind, location, tags, sku, identity, properties, id, resourceGroup
            | order by resourceGroup asc
        `;

        console.log(`Analisi: ${scenario}. Totale Regole: ${rulesData.length}`);

        const result = await client.resources({ query });
        const analyzedResources = (result.data as any[]).map(r => analyzeResource(r, scenario));

        const summary = {
            total: analyzedResources.length,
            blockers: analyzedResources.filter(r => r.migrationStatus === 'Blocker').length,
            critical: analyzedResources.filter(r => r.migrationStatus === 'Critical').length,
            warnings: analyzedResources.filter(r => r.migrationStatus === 'Warning').length,
            ready: analyzedResources.filter(r => r.migrationStatus === 'Ready').length,
            downtimeRisks: analyzedResources.filter(r => r.issues.some(i => i.downtimeRisk)).length
        };

        res.json({ scenario, summary, details: analyzedResources });

    } catch (error: any) {
        console.error("Backend Error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Rules Loaded: Tenant(${tenantRules.length}), RG(${rgRules.length}), Sub(${subRules.length}), Region(${regionRules.length})`);
});