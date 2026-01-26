import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { analyzeResource, MigrationScenario } from './engine';

// Importiamo i file JSON grezzi per tracciare i link
import tenantRules from './rules.json';
import rgRules from './rules-rg.json';
import subRules from './rules-sub.json';
import regionRules from './rules-region.json';

const rulesFiles: Record<string, any[]> = {
    'rules.json': tenantRules,
    'rules-rg.json': rgRules,
    'rules-sub.json': subRules,
    'rules-region.json': regionRules
};

export interface TestResult {
    logic: {
        passed: number;
        failed: number;
        total: number;
        failures: FailureDetail[];
    };
    links: {
        checked: number;
        broken: number;
        details: BrokenLinkDetail[];
    };
}

interface FailureDetail {
    row: number;
    resource: string;
    scenario: string;
    expected: string;
    got: string;
}

interface BrokenLinkDetail {
    file: string;
    ruleId: string;
    url: string;
    status: number | string;
}

// --- HELPER MOCK ---
function createMockResource(provider: string, type: string, conditionNotes: string) {
    const res: any = {
        id: '/subscriptions/xxx/resourceGroups/test/providers/' + provider + '/' + type + '/test-res',
        name: 'test-resource',
        type: provider + '/' + type,
        resourceGroup: 'test-rg',
        location: 'westeurope',
        subscriptionId: 'sub-123', // Necessario per il nuovo engine
        subscriptionName: 'Test Sub',
        sku: {},
        properties: {}
    };
    if (conditionNotes.toLowerCase().includes('standard')) res.sku.name = 'Standard';
    if (conditionNotes.toLowerCase().includes('incremental')) res.properties.incremental = true;
    if (conditionNotes.toLowerCase().includes('running')) res.properties.jobState = 'Running';
    return res;
}

// --- HELPER LINK CHECK ---
async function checkUrl(url: string): Promise<{ valid: boolean; status: number | string }> {
    try {
        const response = await axios.head(url, { 
            timeout: 5000, 
            validateStatus: (s) => s < 400,
            headers: { 'User-Agent': 'AzureMigrationTool/1.0' } // Evita alcuni 403 fake
        });
        return { valid: true, status: response.status };
    } catch (error: any) {
        try {
            const responseGet = await axios.get(url, { 
                timeout: 5000,
                headers: { 'User-Agent': 'AzureMigrationTool/1.0' }
            });
            return { valid: true, status: responseGet.status };
        } catch (errGet: any) {
            return { valid: false, status: errGet.response?.status || 'ERR' };
        }
    }
}

export async function runIntegrationTest(): Promise<TestResult> {
    const csvPath = path.join(__dirname, '../azure-move-matrix.csv');
    
    const logicResult = { passed: 0, failed: 0, total: 0, failures: [] as FailureDetail[] };
    
    if (fs.existsSync(csvPath)) {
        const csvContent = fs.readFileSync(csvPath, 'utf-8');
        const lines = csvContent.split('\n').filter(l => l.trim() !== '');

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(';');
            if (cols.length < 5) continue;

            const provider = cols[0].trim();
            const resType = cols[1].trim();
            
            const rgMoveCsv = cols[2].trim();  // <--- NUOVO: Colonna RG
            const subMoveCsv = cols[3].trim(); // Colonna Sub
            const regMoveCsv = cols[4].trim(); // Colonna Region

            // ----------------------------------------------------
            // TEST 1: Cross-ResourceGroup (AGGIUNTO ORA)
            // ----------------------------------------------------
            const mockRg = createMockResource(provider, resType, rgMoveCsv);
            const resRg = analyzeResource(mockRg, 'cross-resourcegroup');
            const expRgBlock = rgMoveCsv.toLowerCase().startsWith('no') || rgMoveCsv.toLowerCase() == 'pending';
            
            if (expRgBlock && resRg.migrationStatus !== 'Blocker') {
                logicResult.failed++;
                logicResult.failures.push({ 
                    row: i+1, 
                    resource: `${provider}/${resType}`, 
                    scenario: 'ResourceGroup', 
                    expected: 'Blocker', 
                    got: resRg.migrationStatus 
                });
            } else {
                logicResult.passed++;
            }
            logicResult.total++;

            // ----------------------------------------------------
            // TEST 2: Cross-Subscription
            // ----------------------------------------------------
            const mockSub = createMockResource(provider, resType, subMoveCsv);
            const resSub = analyzeResource(mockSub, 'cross-subscription');
            const expSubBlock = subMoveCsv.toLowerCase().startsWith('no') || subMoveCsv.toLowerCase() == 'pending';
            
            if (expSubBlock && resSub.migrationStatus !== 'Blocker') {
                logicResult.failed++;
                logicResult.failures.push({ 
                    row: i+1, 
                    resource: `${provider}/${resType}`, 
                    scenario: 'Subscription', 
                    expected: 'Blocker', 
                    got: resSub.migrationStatus 
                });
            } else {
                logicResult.passed++;
            }
            logicResult.total++;

            // ----------------------------------------------------
            // TEST 3: Cross-Region
            // ----------------------------------------------------
            const mockReg = createMockResource(provider, resType, regMoveCsv);
            const resReg = analyzeResource(mockReg, 'cross-region');
            const expRegCrit = regMoveCsv.toLowerCase().startsWith('no') || regMoveCsv.toLowerCase() == 'pending';

            if (expRegCrit && resReg.migrationStatus !== 'Critical' && resReg.migrationStatus !== 'Warning') {
                 logicResult.failed++;
                 logicResult.failures.push({ 
                     row: i+1, 
                     resource: `${provider}/${resType}`, 
                     scenario: 'Region', 
                     expected: 'Critical', 
                     got: resReg.migrationStatus 
                 });
            } else {
                logicResult.passed++;
            }
            logicResult.total++;
        }
    }

    // 2. TEST LINKS (JSON FILES)
    const linkResult = { checked: 0, broken: 0, details: [] as BrokenLinkDetail[] };
    const linksToCheck: { url: string, file: string, ruleId: string }[] = [];

    for (const [filename, rules] of Object.entries(rulesFiles)) {
        if (Array.isArray(rules)) {
            rules.forEach(r => {
                if (r.refLink && r.refLink.startsWith('http')) {
                    linksToCheck.push({ url: r.refLink, file: filename, ruleId: r.id });
                }
            });
        }
    }

    // Concurrency Limit per non sovraccaricare
    const CHUNK_SIZE = 20;
    for (let i = 0; i < linksToCheck.length; i += CHUNK_SIZE) {
        const chunk = linksToCheck.slice(i, i + CHUNK_SIZE);
        const promises = chunk.map(async (item) => {
            const res = await checkUrl(item.url);
            if (!res.valid) {
                return { file: item.file, ruleId: item.ruleId, url: item.url, status: res.status };
            }
            return null;
        });
        
        const results = await Promise.all(promises);
        results.forEach(r => {
            linkResult.checked++;
            if (r) {
                linkResult.broken++;
                linkResult.details.push(r);
            }
        });
    }

    return { logic: logicResult, links: linkResult };
}