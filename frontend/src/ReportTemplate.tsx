import { Document, Page, Text, View, StyleSheet, Link } from '@react-pdf/renderer';

// --- TIPI ---
interface Issue {
    ruleId?: string; // Utile per il raggruppamento
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

// --- STILI PDF COMPATTI ---
const styles = StyleSheet.create({
    page: { padding: 30, backgroundColor: '#FFFFFF', fontFamily: 'Helvetica', fontSize: 9, color: '#333' },
    
    // Header
    header: { marginBottom: 15, borderBottomWidth: 2, borderBottomColor: '#1E3A8A', paddingBottom: 8 },
    title: { fontSize: 18, color: '#1E3A8A', fontWeight: 'bold' },
    subtitle: { fontSize: 9, color: '#6B7280', marginTop: 2 },
    
    // KPI Compact
    kpiContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, backgroundColor: '#F3F4F6', padding: 8, borderRadius: 4 },
    kpiItem: { alignItems: 'center', width: '16%' },
    kpiLabel: { fontSize: 6, color: '#6B7280', textTransform: 'uppercase', marginBottom: 2 },
    kpiVal: { fontSize: 12, fontWeight: 'bold' },
    
    // Sezioni
    sectionHeader: { marginTop: 15, marginBottom: 8, padding: 5, backgroundColor: '#E0E7FF', borderLeftWidth: 3, borderLeftColor: '#1E40AF' },
    sectionTitle: { fontSize: 11, fontWeight: 'bold', color: '#1E3A8A' },
    
    // Issue Group Header
    issueGroupHeader: { 
        marginTop: 10, 
        backgroundColor: '#FEF2F2', 
        borderLeftWidth: 3, 
        borderLeftColor: '#DC2626',
        padding: 6,
        marginBottom: 0
    },
    issueTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    issueTitle: { fontSize: 9, fontWeight: 'bold', color: '#991B1B' },
    
    issueDetails: { marginTop: 4, paddingLeft: 4 },
    issueLabel: { fontSize: 7, fontWeight: 'bold', color: '#7F1D1D' },
    issueText: { fontSize: 8, color: '#374151', marginBottom: 2 },
    fixBox: { marginTop: 2, backgroundColor: '#1F2937', padding: 4, borderRadius: 2 },
    fixText: { fontSize: 7, fontFamily: 'Courier', color: '#F3F4F6' },

    // Tabelle
    tableHeader: { flexDirection: 'row', backgroundColor: '#F9FAFB', borderBottomWidth: 1, borderColor: '#E5E7EB', padding: 4, marginTop: 4 },
    tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#E5E7EB', padding: 3 },
    
    // Colonne Tabella
    colRG: { width: '25%' },
    colName: { width: '35%' },
    colType: { width: '25%' },
    colLoc: { width: '15%', textAlign: 'right' },
    
    // Ready Section
    readyHeader: { marginTop: 15, marginBottom: 5, padding: 5, backgroundColor: '#ECFDF5', borderLeftWidth: 3, borderLeftColor: '#059669' },
    readyTitle: { fontSize: 10, fontWeight: 'bold', color: '#065F46' },

    // Footer
    pageNumber: { position: 'absolute', bottom: 20, left: 0, right: 0, textAlign: 'center', fontSize: 8, color: 'grey' }
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

export const MigrationReport = ({ data }: ReportProps) => {

    // --- LOGICA DI TRASFORMAZIONE DATI (Inverted Index) ---
    const transformedData = (() => {
        const subs: any = {};

        data.details.forEach(res => {
            const subName = res.subscriptionName || res.subscriptionId;
            if (!subs[subName]) {
                subs[subName] = { 
                    name: subName, 
                    issuesMap: {}, // Raggruppa per RuleID/Messaggio
                    readyList: [], // Lista pulita per i Ready
                    infoList: []   // Lista per Info
                };
            }

            // Se è Ready, va nella lista semplice
            if (res.migrationStatus === 'Ready') {
                subs[subName].readyList.push(res);
                return;
            }

            // Se è Info, va nella lista info
            if (res.migrationStatus === 'Info') {
                subs[subName].infoList.push(res);
                return;
            }

            // Se ha problemi (Blocker/Critical/Warning), raggruppa per Issue
            res.issues.forEach(issue => {
                // Chiave unica per l'errore (usa ID regola o messaggio se manca ID)
                const issueKey = issue.ruleId || issue.message;
                
                if (!subs[subName].issuesMap[issueKey]) {
                    subs[subName].issuesMap[issueKey] = {
                        details: issue, // Dettagli completi del problema (salvati una volta sola)
                        affectedResources: []
                    };
                }
                subs[subName].issuesMap[issueKey].affectedResources.push(res);
            });
        });

        // Convertiamo la mappa in array ordinati per severità
        return Object.values(subs).map((sub: any) => {
            const issuesArray = Object.values(sub.issuesMap).sort((a: any, b: any) => {
                const weight = { 'Blocker': 4, 'Critical': 3, 'Warning': 2, 'Info': 1 };
                return (weight[b.details.severity as keyof typeof weight] || 0) - (weight[a.details.severity as keyof typeof weight] || 0);
            });
            return { ...sub, issuesArray };
        });
    })();

    return (
        <Document>
            <Page style={styles.page}>
                
                {/* HEAD (Pagina 1) */}
                <View style={styles.header}>
                    <Text style={styles.title}>Azure Migration Assessment</Text>
                    <Text style={styles.subtitle}>
                        Scenario: {data.scenario.toUpperCase()} 
                        {data.targetRegion ? `  >  Target: ${data.targetRegion}` : ''} 
                        {'  |  '} Created: {new Date().toLocaleDateString()}
                    </Text>
                </View>

                <View style={styles.kpiContainer}>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Total</Text><Text style={styles.kpiVal}>{data.summary.total}</Text></View>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Blockers</Text><Text style={{...styles.kpiVal, color: '#991B1B'}}>{data.summary.blockers}</Text></View>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Critical</Text><Text style={{...styles.kpiVal, color: '#DC2626'}}>{data.summary.critical}</Text></View>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Warnings</Text><Text style={{...styles.kpiVal, color: '#D97706'}}>{data.summary.warnings}</Text></View>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Ready</Text><Text style={{...styles.kpiVal, color: '#059669'}}>{data.summary.ready}</Text></View>
                </View>

                {/* CONTENUTO PER SOTTOSCRIZIONE */}
                {transformedData.map((sub: any, idx) => (
                    <View key={idx} break={idx > 0}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>SUBSCRIPTION: {sub.name}</Text>
                        </View>

                        {/* --- SEZIONE 1: PROBLEMI ACCORPATI --- */}
                        {sub.issuesArray.length > 0 ? (
                            <View>
                                <Text style={{fontSize: 10, marginBottom: 5, fontWeight: 'bold', color: '#4B5563'}}>⚠️ Action Required Items</Text>
                                {sub.issuesArray.map((group: any, gIdx: number) => (
                                    <View key={gIdx} wrap={false} style={{marginBottom: 12}}>
                                        {/* HEADER PROBLEMA (Stampato una volta) */}
                                        <View style={styles.issueGroupHeader}>
                                            <View style={styles.issueTitleRow}>
                                                <Text style={{...styles.issueTitle, color: getStatusColor(group.details.severity)}}>
                                                    [{group.details.severity.toUpperCase()}] {group.details.message}
                                                </Text>
                                                <Text style={{fontSize: 7, color: '#6B7280'}}>Affects: {group.affectedResources.length} resources</Text>
                                            </View>
                                            
                                            <View style={styles.issueDetails}>
                                                <Text style={styles.issueText}><Text style={styles.issueLabel}>IMPACT: </Text>{group.details.impact}</Text>
                                                <View style={styles.fixBox}>
                                                    <Text style={styles.fixText}>FIX: {group.details.workaround}</Text>
                                                </View>
                                                {group.details.refLink && (
                                                    <Link src={group.details.refLink} style={{fontSize: 7, color: '#2563EB', marginTop: 2}}>Reference Documentation</Link>
                                                )}
                                            </View>
                                        </View>

                                        {/* TABELLA RISORSE AFFETTE */}
                                        <View style={styles.tableHeader}>
                                            <Text style={[styles.colRG, {fontWeight:'bold'}]}>Resource Group</Text>
                                            <Text style={[styles.colName, {fontWeight:'bold'}]}>Resource Name</Text>
                                            <Text style={[styles.colType, {fontWeight:'bold'}]}>Type</Text>
                                            <Text style={[styles.colLoc, {fontWeight:'bold'}]}>Region</Text>
                                        </View>
                                        {group.affectedResources.map((res: any, rIdx: number) => (
                                            <View key={rIdx} style={styles.tableRow}>
                                                <Text style={styles.colRG}>{res.resourceGroup}</Text>
                                                <Text style={styles.colName}>{res.name}</Text>
                                                <Text style={styles.colType}>{res.type.split('/').pop()}</Text>
                                                <Text style={styles.colLoc}>{res.location}</Text>
                                            </View>
                                        ))}
                                    </View>
                                ))}
                            </View>
                        ) : (
                            <Text style={{fontSize: 9, color: '#059669', marginBottom: 10}}>✅ No blockers or warnings found in this subscription.</Text>
                        )}

                        {/* --- SEZIONE 2: INFO --- */}
                        {sub.infoList.length > 0 && (
                            <View style={{marginTop: 10}} wrap={false}>
                                <View style={{...styles.readyHeader, backgroundColor: '#EFF6FF', borderLeftColor: '#2563EB'}}>
                                    <Text style={{...styles.readyTitle, color: '#1E40AF'}}>ℹ️ Informational Items ({sub.infoList.length})</Text>
                                </View>
                                <View style={styles.tableHeader}>
                                    <Text style={styles.colRG}>Resource Group</Text>
                                    <Text style={styles.colName}>Name</Text>
                                    <Text style={styles.colType}>Type</Text>
                                    <Text style={styles.colLoc}>Region</Text>
                                </View>
                                {sub.infoList.map((res: any, rIdx: number) => (
                                    <View key={rIdx} style={styles.tableRow}>
                                        <Text style={styles.colRG}>{res.resourceGroup}</Text>
                                        <Text style={styles.colName}>{res.name}</Text>
                                        <Text style={styles.colType}>{res.type.split('/').pop()}</Text>
                                        <Text style={styles.colLoc}>{res.location}</Text>
                                    </View>
                                ))}
                            </View>
                        )}

                        {/* --- SEZIONE 3: READY --- */}
                        {sub.readyList.length > 0 && (
                            <View style={{marginTop: 10}} wrap={false}>
                                <View style={styles.readyHeader}>
                                    <Text style={styles.readyTitle}>✅ Ready to Migrate ({sub.readyList.length})</Text>
                                </View>
                                <View style={styles.tableHeader}>
                                    <Text style={styles.colRG}>Resource Group</Text>
                                    <Text style={styles.colName}>Name</Text>
                                    <Text style={styles.colType}>Type</Text>
                                    <Text style={styles.colLoc}>Region</Text>
                                </View>
                                {sub.readyList.map((res: any, rIdx: number) => (
                                    <View key={rIdx} style={styles.tableRow}>
                                        <Text style={styles.colRG}>{res.resourceGroup}</Text>
                                        <Text style={styles.colName}>{res.name}</Text>
                                        <Text style={styles.colType}>{res.type.split('/').pop()}</Text>
                                        <Text style={styles.colLoc}>{res.location}</Text>
                                    </View>
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