import { Document, Page, Text, View, StyleSheet, Link } from '@react-pdf/renderer';

// --- TIPI ---
interface Issue {
    ruleId?: string;
    severity: string; message: string; impact: string; workaround: string; 
    downtimeRisk: boolean; refLink?: string;
}

interface Resource {
    id: string; name: string; type: string; resourceGroup: string; 
    subscriptionId: string; subscriptionName?: string; location: string; 
    migrationStatus: string; issues: Issue[];
}

interface Summary {
    total: number; blockers: number; critical: number; 
    warnings: number; ready: number; downtimeRisks: number;
}

interface ReportProps {
    data: {
        scenario: string;
        summary: Summary;
        details: Resource[];
        targetRegion?: string;
    };
}

// --- STILI PDF OTTIMIZZATI ---
const styles = StyleSheet.create({
    page: { 
        paddingTop: 30, paddingBottom: 40, paddingHorizontal: 30, 
        backgroundColor: '#FFFFFF', fontFamily: 'Helvetica', fontSize: 9, color: '#333' 
    },
    
    // Header
    header: { marginBottom: 15, borderBottomWidth: 2, borderBottomColor: '#1E3A8A', paddingBottom: 8 },
    title: { fontSize: 18, color: '#1E3A8A', fontWeight: 'bold' },
    subtitle: { fontSize: 9, color: '#6B7280', marginTop: 2 },
    
    // KPI
    kpiContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, backgroundColor: '#F3F4F6', padding: 8, borderRadius: 4 },
    kpiItem: { alignItems: 'center', width: '16%' },
    kpiLabel: { fontSize: 6, color: '#6B7280', textTransform: 'uppercase', marginBottom: 2 },
    kpiVal: { fontSize: 12, fontWeight: 'bold' },
    
    // Sezioni
    sectionHeader: { marginTop: 15, marginBottom: 8, padding: 5, backgroundColor: '#E0E7FF', borderLeftWidth: 3, borderLeftColor: '#1E40AF' },
    sectionTitle: { fontSize: 11, fontWeight: 'bold', color: '#1E3A8A' },
    
    // Action Required Items (Issues)
    issueGroupContainer: { marginBottom: 10, break: false },
    issueGroupHeader: { 
        backgroundColor: '#FEF2F2', borderLeftWidth: 3, borderLeftColor: '#DC2626',
        padding: 6, marginBottom: 0
    },
    issueTitle: { fontSize: 9, fontWeight: 'bold', color: '#991B1B' },
    issueMeta: { marginTop: 4, paddingLeft: 4 },
    issueText: { fontSize: 8, color: '#374151', marginBottom: 2 },
    fixBox: { marginTop: 2, backgroundColor: '#1F2937', padding: 4, borderRadius: 2 },
    fixText: { fontSize: 7, fontFamily: 'Courier', color: '#F3F4F6' },
    
    // Tabelle
    tableContainer: { marginTop: 0 },
    tableHeader: { 
        flexDirection: 'row', backgroundColor: '#F9FAFB', 
        borderBottomWidth: 1, borderColor: '#E5E7EB', padding: 4,
        marginTop: 2
    },
    tableRow: { 
        flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#E5E7EB', 
        paddingVertical: 6, paddingHorizontal: 4, minHeight: 15,
        alignItems: 'flex-start' // Allinea il testo in alto se va a capo
    },
    
    // --- COLONNE RIDIMENSIONATE (35-35-15-15) ---
    colRG: { width: '35%', fontSize: 8, color: '#4B5563', paddingRight: 4 },
    colName: { width: '35%', fontSize: 8, fontWeight: 'bold', color: '#111827', paddingRight: 4 },
    colType: { width: '15%', fontSize: 7, color: '#6B7280', paddingRight: 2 },
    colLoc: { width: '15%', fontSize: 7, color: '#9CA3AF', textAlign: 'right' },
    
    // Headers Sezioni Specifiche
    readyHeader: { marginTop: 15, marginBottom: 5, padding: 5, backgroundColor: '#ECFDF5', borderLeftWidth: 3, borderLeftColor: '#059669' },
    infoHeader: { marginTop: 15, marginBottom: 5, padding: 5, backgroundColor: '#F3F4F6', borderLeftWidth: 3, borderLeftColor: '#6B7280' },
    sectionLabel: { fontSize: 10, fontWeight: 'bold' },

    // Footer
    pageNumber: { position: 'absolute', bottom: 15, left: 0, right: 0, textAlign: 'center', fontSize: 7, color: '#9CA3AF' }
});

const getStatusColor = (status: string) => {
    switch (status) {
        case 'Blocker': return '#991B1B';
        case 'Critical': return '#DC2626';
        case 'Warning': return '#D97706';
        case 'Ready': return '#059669';
        default: return '#2563EB';
    }
};

const SEVERITY_WEIGHT: Record<string, number> = { 'Blocker': 5, 'Critical': 4, 'Warning': 3, 'Info': 2, 'Ready': 1 };

export const MigrationReport = ({ data }: ReportProps) => {

    const transformedData = (() => {
        const subs: any = {};
        data.details.forEach(res => {
            const subName = res.subscriptionName || res.subscriptionId;
            if (!subs[subName]) {
                subs[subName] = { 
                    name: subName, 
                    issuesMap: {}, 
                    readyList: [], 
                    infoList: []   
                };
            }
            if (res.migrationStatus === 'Ready') { subs[subName].readyList.push(res); return; }
            if (res.migrationStatus === 'Info') { subs[subName].infoList.push(res); return; }

            res.issues.forEach(issue => {
                const issueKey = issue.ruleId || issue.message;
                if (!subs[subName].issuesMap[issueKey]) {
                    subs[subName].issuesMap[issueKey] = { details: issue, affectedResources: [] };
                }
                subs[subName].issuesMap[issueKey].affectedResources.push(res);
            });
        });

        return Object.values(subs).map((sub: any) => {
            const issuesArray = Object.values(sub.issuesMap).sort((a: any, b: any) => {
                const weight = { 'Blocker': 4, 'Critical': 3, 'Warning': 2, 'Info': 1 };
                return (weight[b.details.severity as keyof typeof weight] || 0) - (weight[a.details.severity as keyof typeof weight] || 0);
            });
            return { ...sub, issuesArray };
        });
    })();

    const ResourceRow = ({ res }: { res: any }) => (
        <View style={styles.tableRow} wrap={false}> 
            <Text style={styles.colRG}>{res.resourceGroup}</Text>
            <Text style={styles.colName}>{res.name}</Text>
            <Text style={styles.colType}>{res.type.split('/').pop()}</Text>
            <Text style={styles.colLoc}>{res.location}</Text>
        </View>
    );

    const TableHeader = () => (
        <View style={styles.tableHeader} fixed> 
            <Text style={[styles.colRG, { fontWeight: 'bold' }]}>Resource Group</Text>
            <Text style={[styles.colName, { fontWeight: 'bold' }]}>Resource Name</Text>
            <Text style={[styles.colType, { fontWeight: 'bold' }]}>Type</Text>
            <Text style={[styles.colLoc, { fontWeight: 'bold' }]}>Region</Text>
        </View>
    );

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                
                {/* HEAD */}
                <View style={styles.header}>
                    <Text style={styles.title}>Azure Migration Assessment</Text>
                    <Text style={styles.subtitle}>
                        Scenario: {data.scenario.toUpperCase()} 
                        {data.targetRegion ? `  >  Target: ${data.targetRegion}` : ''} 
                        {'  |  '} Created: {new Date().toLocaleDateString()}
                    </Text>
                </View>

                {/* KPI */}
                <View style={styles.kpiContainer}>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Total</Text><Text style={styles.kpiVal}>{data.summary.total}</Text></View>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Blockers</Text><Text style={{...styles.kpiVal, color: '#991B1B'}}>{data.summary.blockers}</Text></View>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Critical</Text><Text style={{...styles.kpiVal, color: '#DC2626'}}>{data.summary.critical}</Text></View>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Warnings</Text><Text style={{...styles.kpiVal, color: '#D97706'}}>{data.summary.warnings}</Text></View>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Ready</Text><Text style={{...styles.kpiVal, color: '#059669'}}>{data.summary.ready}</Text></View>
                </View>

                {/* LOOP SOTTOSCRIZIONI */}
                {transformedData.map((sub: any, idx) => (
                    <View key={idx}>
                        <View style={styles.sectionHeader} break={idx > 0}>
                            <Text style={styles.sectionTitle}>SUBSCRIPTION: {sub.name}</Text>
                        </View>

                        {/* 1. ACTION REQUIRED ITEMS (Blocker/Critical/Warning) */}
                        {sub.issuesArray.length > 0 ? (
                            <View>
                                {sub.issuesArray.map((group: any, gIdx: number) => (
                                    <View key={gIdx} style={styles.issueGroupContainer}> 
                                        {/* Box Problema */}
                                        <View style={styles.issueGroupHeader} wrap={false}>
                                            <Text style={{fontSize: 9, fontWeight: 'bold', color: getStatusColor(group.details.severity)}}>
                                                [{group.details.severity.toUpperCase()}] {group.details.message}
                                            </Text>
                                            <View style={styles.issueMeta}>
                                                <Text style={styles.issueText}>IMPACT: {group.details.impact}</Text>
                                                <View style={styles.fixBox}><Text style={styles.fixText}>FIX: {group.details.workaround}</Text></View>
                                                {group.details.refLink && <Link src={group.details.refLink} style={{fontSize: 7, color: '#2563EB', marginTop: 2}}>Documentation Link</Link>}
                                            </View>
                                        </View>

                                        {/* Tabella Risorse Affette */}
                                        <View style={styles.tableContainer}>
                                            <TableHeader />
                                            {group.affectedResources.map((res: any, rIdx: number) => (
                                                <ResourceRow key={rIdx} res={res} />
                                            ))}
                                        </View>
                                    </View>
                                ))}
                            </View>
                        ) : null}

                        {/* 2. INFORMATIONAL ITEMS */}
                        {sub.infoList.length > 0 && (
                            <View style={{marginTop: 10}}>
                                <View style={styles.infoHeader} wrap={false}>
                                    <Text style={{...styles.sectionLabel, color: '#374151'}}>ℹ️ Informational Items ({sub.infoList.length})</Text>
                                </View>
                                <TableHeader />
                                {sub.infoList.map((res: any, rIdx: number) => (
                                    <ResourceRow key={rIdx} res={res} />
                                ))}
                            </View>
                        )}

                        {/* 3. READY ITEMS */}
                        {sub.readyList.length > 0 && (
                            <View style={{marginTop: 10}}>
                                <View style={styles.readyHeader} wrap={false}>
                                    <Text style={{...styles.sectionLabel, color: '#065F46'}}>✅ Ready to Migrate ({sub.readyList.length})</Text>
                                </View>
                                <TableHeader />
                                {sub.readyList.map((res: any, rIdx: number) => (
                                    <ResourceRow key={rIdx} res={res} />
                                ))}
                            </View>
                        )}

                    </View>
                ))}

                <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => (
                    `${pageNumber} / ${totalPages}`
                )} fixed />
            </Page>
        </Document>
    );
};