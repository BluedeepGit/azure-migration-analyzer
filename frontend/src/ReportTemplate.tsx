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

// --- STILI PDF ---
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
    
    // Sezioni Sottoscrizione
    sectionHeader: { marginTop: 15, marginBottom: 8, padding: 5, backgroundColor: '#E0E7FF', borderLeftWidth: 3, borderLeftColor: '#1E40AF' },
    sectionTitle: { fontSize: 11, fontWeight: 'bold', color: '#1E3A8A' },
    
    // --- STILI PER ACTION ITEMS (Dettagliati) ---
    issueGroupContainer: { marginBottom: 10, break: false },
    issueGroupHeader: { 
        backgroundColor: '#FEF2F2', borderLeftWidth: 3, borderLeftColor: '#DC2626',
        padding: 6, marginBottom: 0
    },
    issueTitle: { fontSize: 9, fontWeight: 'bold' },
    issueMeta: { marginTop: 4, paddingLeft: 4 },
    issueText: { fontSize: 8, color: '#374151', marginBottom: 2 },
    fixBox: { marginTop: 2, backgroundColor: '#1F2937', padding: 4, borderRadius: 2 },
    fixText: { fontSize: 7, fontFamily: 'Courier', color: '#F3F4F6' },
    
    // Tabelle (Solo per Action Items)
    tableContainer: { marginTop: 0 },
    tableHeader: { 
        flexDirection: 'row', backgroundColor: '#F9FAFB', 
        borderBottomWidth: 1, borderColor: '#E5E7EB', padding: 4,
        marginTop: 2
    },
    tableRow: { 
        flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#E5E7EB', 
        paddingVertical: 4, paddingHorizontal: 4, minHeight: 12,
        alignItems: 'flex-start' 
    },
    colRG: { width: '35%', fontSize: 8, color: '#4B5563', paddingRight: 4 },
    colName: { width: '35%', fontSize: 8, fontWeight: 'bold', color: '#111827', paddingRight: 4 },
    colType: { width: '15%', fontSize: 7, color: '#6B7280', paddingRight: 2 },
    colLoc: { width: '15%', fontSize: 7, color: '#9CA3AF', textAlign: 'right' },
    
    // --- STILI PER INFO ITEMS (Compatti) ---
    infoBox: {
        marginTop: 6,
        padding: 8,
        backgroundColor: '#EFF6FF', 
        borderLeftWidth: 3,
        borderLeftColor: '#3B82F6',
        borderRadius: 2,
        marginBottom: 4
    },
    infoTitleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    infoTitle: { fontSize: 9, fontWeight: 'bold', color: '#1E40AF', width: '80%' },
    infoCountBadge: { fontSize: 8, fontWeight: 'bold', color: '#FFFFFF', backgroundColor: '#3B82F6', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
    infoText: { fontSize: 8, color: '#1E3A8A' },

    // --- STILI PER READY ITEMS (Compatti) ---
    readyBox: {
        marginTop: 15,
        padding: 8,
        backgroundColor: '#F0FDF4', 
        borderLeftWidth: 3,
        borderLeftColor: '#059669',
        borderRadius: 2
    },
    readyTitle: { fontSize: 9, fontWeight: 'bold', color: '#065F46', marginBottom: 2 },
    readyText: { fontSize: 8, color: '#064E3B' },

    // Footer
    pageNumber: { position: 'absolute', bottom: 15, left: 0, right: 0, textAlign: 'center', fontSize: 7, color: '#9CA3AF' }
});

const getSeverityColor = (severity: string) => {
    switch (severity) {
        case 'Blocker': return '#991B1B';
        case 'Critical': return '#DC2626';
        case 'Warning': return '#D97706';
        case 'Info': return '#1E40AF';
        default: return '#374151';
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
                    actionMap: {}, // Blocker/Critical/Warning
                    infoMap: {},   // Info
                    readyCount: 0  // Ready
                };
            }

            if (res.migrationStatus === 'Ready') {
                subs[subName].readyCount++;
                return;
            }

            res.issues.forEach(issue => {
                const issueKey = issue.ruleId || issue.message;
                const targetMap = issue.severity === 'Info' ? subs[subName].infoMap : subs[subName].actionMap;
                
                if (!targetMap[issueKey]) {
                    targetMap[issueKey] = { details: issue, affectedResources: [] };
                }
                targetMap[issueKey].affectedResources.push(res);
            });
        });

        return Object.values(subs).map((sub: any) => {
            // Ordina Action Items per gravità
            const actionItems = Object.values(sub.actionMap).sort((a: any, b: any) => {
                const w = { 'Blocker': 3, 'Critical': 2, 'Warning': 1 };
                return (w[b.details.severity as keyof typeof w] || 0) - (w[a.details.severity as keyof typeof w] || 0);
            });
            // Info items
            const infoItems = Object.values(sub.infoMap);
            
            return { ...sub, actionItems, infoItems };
        });
    })();

    // Componenti Tabella (Usati solo per Action Items)
    const TableHeader = () => (
        <View style={styles.tableHeader} fixed> 
            <Text style={[styles.colRG, { fontWeight: 'bold' }]}>Resource Group</Text>
            <Text style={[styles.colName, { fontWeight: 'bold' }]}>Resource Name</Text>
            <Text style={[styles.colType, { fontWeight: 'bold' }]}>Type</Text>
            <Text style={[styles.colLoc, { fontWeight: 'bold' }]}>Region</Text>
        </View>
    );

    const ResourceRows = ({ resources }: { resources: any[] }) => (
        <>
            {resources.map((res: any, idx: number) => (
                <View key={idx} style={styles.tableRow} wrap={false}>
                    <Text style={styles.colRG}>{res.resourceGroup}</Text>
                    <Text style={styles.colName}>{res.name}</Text>
                    <Text style={styles.colType}>{res.type.split('/').pop()}</Text>
                    <Text style={styles.colLoc}>{res.location}</Text>
                </View>
            ))}
        </>
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

                {/* LOOP SUBSCRIPTIONS */}
                {transformedData.map((sub: any, idx) => (
                    <View key={idx} break={idx > 0}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>SUBSCRIPTION: {sub.name}</Text>
                        </View>

                        {/* 1. ACTION REQUIRED ITEMS (Dettagliati con Tabella) */}
                        {sub.actionItems.length > 0 ? (
                            <View>
                                <Text style={{fontSize: 9, fontWeight: 'bold', color: '#B91C1C', marginBottom: 4, marginTop: 4}}>⚠️ ATTENTION REQUIRED</Text>
                                {sub.actionItems.map((group: any, gIdx: number) => (
                                    <View key={gIdx} style={styles.issueGroupContainer} wrap={false}>
                                        <View style={styles.issueGroupHeader}>
                                            <Text style={{fontSize: 9, fontWeight: 'bold', color: getSeverityColor(group.details.severity)}}>
                                                [{group.details.severity.toUpperCase()}] {group.details.message}
                                            </Text>
                                            <View style={styles.issueMeta}>
                                                <Text style={styles.issueText}>IMPACT: {group.details.impact}</Text>
                                                {group.details.workaround && (
                                                    <View style={styles.fixBox}><Text style={styles.fixText}>FIX: {group.details.workaround}</Text></View>
                                                )}
                                                {group.details.refLink && <Link src={group.details.refLink} style={{fontSize: 7, color: '#2563EB', marginTop: 2}}>Documentation Link</Link>}
                                            </View>
                                        </View>
                                        <View style={styles.tableContainer}>
                                            <TableHeader />
                                            <ResourceRows resources={group.affectedResources} />
                                        </View>
                                    </View>
                                ))}
                            </View>
                        ) : (
                            <Text style={{fontSize: 9, color: '#059669', marginBottom: 10, fontStyle:'italic'}}>No blockers or warnings found.</Text>
                        )}

                        {/* 2. INFORMATIONAL ITEMS (Solo Box Riassuntivo) */}
                        {sub.infoItems.length > 0 && (
                            <View style={{marginTop: 10}}>
                                <Text style={{fontSize: 9, fontWeight: 'bold', color: '#1E40AF', marginBottom: 4}}>ℹ️ INFORMATIONAL ITEMS</Text>
                                {sub.infoItems.map((group: any, gIdx: number) => (
                                    <View key={gIdx} style={styles.infoBox} wrap={false}>
                                        <View style={styles.infoTitleRow}>
                                            <Text style={styles.infoTitle}>[INFO] {group.details.message}</Text>
                                            <Text style={styles.infoCountBadge}>Affects: {group.affectedResources.length} resources</Text>
                                        </View>
                                        <Text style={styles.infoText}>{group.details.impact}</Text>
                                        {group.details.refLink && <Link src={group.details.refLink} style={{fontSize: 7, color: '#2563EB', marginTop: 2}}>Read More</Link>}
                                    </View>
                                ))}
                            </View>
                        )}

                        {/* 3. READY ITEMS (Solo Box Totale) */}
                        {sub.readyCount > 0 && (
                            <View style={styles.readyBox} wrap={false}>
                                <Text style={styles.readyTitle}>✓ Migration Readiness Summary</Text>
                                <Text style={styles.readyText}>
                                    Total of <Text style={{fontWeight: 'bold'}}>{sub.readyCount}</Text> resources passed validation checks. 
                                    These resources are ready to be included in the migration plan without specific remediation.
                                </Text>
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