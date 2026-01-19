import fs from 'fs';
import path from 'path';
import { analyzeResource } from './engine';

export interface TestResult {
    passed: number;
    failed: number;
    total: number;
    failures: FailureDetail[];
}

interface FailureDetail {
    row: number;
    resource: string;
    scenario: string;
    expected: string;
    got: string;
    csvLink: string;
}

// Helper per creare il Mock
function createMockResource(provider: string, type: string, conditionNotes: string) {
    const res: any = {
        id: '/subscriptions/xxx/resourceGroups/test/providers/' + provider + '/' + type + '/test-res',
        name: 'test-resource',
        type: provider + '/' + type,
        resourceGroup: 'test-rg',
        location: 'westeurope',
        sku: {},
        properties: {}
    };

    // Auto-Mocking delle condizioni comuni
    if (conditionNotes.toLowerCase().includes('standard')) res.sku.name = 'Standard';
    if (conditionNotes.toLowerCase().includes('incremental')) res.properties.incremental = true;
    if (conditionNotes.toLowerCase().includes('running')) res.properties.jobState = 'Running';
    
    return res;
}

export function runIntegrationTest(): TestResult {
    // Il CSV è nella stessa cartella di esecuzione (dist/) su Azure
    const csvPath = path.join(__dirname, '../azure-move-matrix.csv'); 
    
    const result: TestResult = { passed: 0, failed: 0, total: 0, failures: [] };

    if (!fs.existsSync(csvPath)) {
        throw new Error(`File CSV non trovato nel percorso: ${csvPath}. Assicurarsi che sia copiato nella build.`);
    }

    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.split('\n').filter(l => l.trim() !== '');

    // Salta header
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(';');
        if (cols.length < 5) continue;

        const provider = cols[0].trim();
        const resType = cols[1].trim();
        const subMoveCsv = cols[3].trim();
        const regMoveCsv = cols[4].trim();
        const link = cols[5]?.trim() || '';

        // --- TEST 1: Cross-Subscription ---
        const mockResSub = createMockResource(provider, resType, subMoveCsv);
        const engineResultSub = analyzeResource(mockResSub, 'cross-subscription');
        
        const expectBlock = subMoveCsv.toLowerCase().startsWith('no') || subMoveCsv.toLowerCase() == 'pending';
        const isBlock = engineResultSub.migrationStatus === 'Blocker';

        // Logica Pass/Fail (Tolleriamo se il CSV dice Yes ma noi diamo Warning/Info, ma NON se diamo Ready quando è No)
        if (expectBlock) {
            if (isBlock) {
                result.passed++;
            } else {
                result.failed++;
                result.failures.push({
                    row: i + 1,
                    resource: `${provider}/${resType}`,
                    scenario: 'Subscription Move',
                    expected: `BLOCKER (CSV: ${subMoveCsv})`,
                    got: engineResultSub.migrationStatus,
                    csvLink: link
                });
            }
        } else {
            result.passed++;
        }

        // --- TEST 2: Cross-Region ---
        const mockResReg = createMockResource(provider, resType, regMoveCsv);
        const engineResultReg = analyzeResource(mockResReg, 'cross-region');

        const expectCrit = regMoveCsv.toLowerCase().startsWith('no') || regMoveCsv.toLowerCase() == 'pending';
        // Region Move "No" nel CSV = Critical o Warning nel nostro engine (Redeploy)
        const isCrit = engineResultReg.migrationStatus === 'Critical' || engineResultReg.migrationStatus === 'Warning';

        if (expectCrit) {
            if (isCrit) {
                result.passed++;
            } else {
                result.failed++;
                result.failures.push({
                    row: i + 1,
                    resource: `${provider}/${resType}`,
                    scenario: 'Region Move',
                    expected: `CRITICAL/WARNING (CSV: ${regMoveCsv})`,
                    got: engineResultReg.migrationStatus,
                    csvLink: link
                });
            }
        } else {
            result.passed++;
        }

        result.total += 2; // Due test per riga
    }

    return result;
}