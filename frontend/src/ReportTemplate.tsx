import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';

// --- TIPI ---
interface Resource {
    id: string; name: string; type: string; resourceGroup: string; 
    subscriptionId: string; subscriptionName?: string; location: string; 
    migrationStatus: string; issues: any[];
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
        padding: 30, 
        backgroundColor: '#FFFFFF', 
        fontFamily: 'Helvetica',
        fontSize: 10,
        color: '#333333'
    },
    
    // Header Principale
    header: { 
        marginBottom: 20, 
        borderBottomWidth: 2, 
        borderBottomColor: '#2563EB', 
        paddingBottom: 10 
    },
    title: { 
        fontSize: 24, 
        color: '#1E3A8A', 
        fontWeight: 'bold' 
    },
    subtitle: { 
        fontSize: 10, 
        color: '#6B7280', 
        marginTop: 5 
    },
    
    // KPI Summary Box
    kpiContainer: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        marginBottom: 25, 
        backgroundColor: '#F3F4F6', 
        padding: 12, 
        borderRadius: 4,
        borderWidth: 1,
        borderColor: '#E5E7EB'
    },
    kpiBox: { alignItems: 'center', width: '18%' },
    kpiLabel: { fontSize: 7, color: '#6B7280', textTransform: 'uppercase', marginBottom: 2 },
    kpiValue: { fontSize: 16, fontWeight: 'bold' },
    
    // Gerarchia: Subscription
    subHeader: { 
        marginTop: 15, 
        marginBottom: 8, 
        padding: 8, 
        backgroundColor: '#1E40AF', // Blu Scuro
        color: 'white',
        flexDirection: 'row', 
        justifyContent: 'space-between',
        borderRadius: 2
    },
    subTitle: { fontSize: 12, fontWeight: 'bold' },
    subId: { fontSize: 8, fontFamily: 'Courier', opacity: 0.8 },

    // Gerarchia: Resource Group
    rgContainer: {
        marginLeft: 0,
        marginBottom: 10,
        borderLeftWidth: 2,
        borderLeftColor: '#E5E7EB'
    },
    rgHeader: { 
        marginTop: 5, 
        marginBottom: 0, 
        paddingVertical: 4,
        paddingHorizontal: 8,
        backgroundColor: '#F9FAFB', // Grigio chiarissimo
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
        flexDirection: 'row',
        justifyContent: 'space-between'
    },
    rgTitle: { fontSize: 10, fontWeight: 'bold', color: '#374151' },
    
    // Tabella Risorse
    resourceRow: { 
        flexDirection: 'row', 
        borderBottomWidth: 1, 
        borderBottomColor: '#F3F4F6', 
        paddingVertical: 8, 
        paddingHorizontal: 8,
    },
    
    // Colonne (Flex)
    colName: { width: '45%', paddingRight: 5 },
    colType: { width: '35%', paddingRight: 5 },
    colStatus: { width: '20%', alignItems: 'flex-end' },
    
    // Testi
    resName: { fontSize: 9, fontWeight: 'bold', color: '#111827', marginBottom: 2 },
    resSubtext: { fontSize: 8, color: '#6B7280', fontFamily: 'Courier' }, // Per ID o Location
    resType: { fontSize: 8, color: '#4B5563' },
    
    // Box Problemi (Issues)
    issueContainer: {
        marginTop: 6,
        padding: 6,
        backgroundColor: '#FEF2F2', // Rosso chiarissimo
        borderRadius: 2,
        borderLeftWidth: 2,
        borderLeftColor: '#DC2626'
    },
    issueTitle: { fontSize: 8, fontWeight: 'bold', color: '#991B1B', marginBottom: 2 },
    issueText: { fontSize: 8, color: '#374151', marginBottom: 2 },
    
    // Box Workaround (Stile Codice)
    fixBox: {
        marginTop: 4,
        backgroundColor: '#1F2937', // Grigio scuro
        padding: 4,
        borderRadius: 2
    },
    fixLabel: { color: '#34D399', fontSize: 7, fontWeight: 'bold', marginBottom: 1 },
    fixContent: { color: '#F3F4F6', fontSize: 7, fontFamily: 'Courier' },

    // Badges
    badge: { 
        paddingHorizontal: 6, 
        paddingVertical: 2, 
        borderRadius: 4, 
        fontSize: 7, 
        fontWeight: 'bold', 
        color: 'white',
        textAlign: 'center',
        width: 60
    },

    // Footer
    footer: {
        position: 'absolute', 
        bottom: 20, 
        left: 30, 
        right: 30, 
        textAlign: 'center', 
        fontSize: 8, 
        color: '#9CA3AF',
        borderTopWidth: 1,
        borderTopColor: '#E5E7EB',
        paddingTop: 10
    }
});

// Colori Badge
const getStatusColor = (status: string) => {
    switch (status) {
        case 'Blocker': return '#991B1B'; // Rosso scuro
        case 'Critical': return '#DC2626'; // Rosso
        case 'Warning': return '#D97706'; // Arancio
        case 'Info': return '#2563EB';    // Blu
        case 'Ready': return '#059669';   // Verde
        default: return '#6B7280';        // Grigio
    }
};

const SEVERITY_WEIGHT: Record<string, number> = { 'Blocker': 5, 'Critical': 4, 'Warning': 3, 'Info': 2, 'Ready': 1 };

export const MigrationReport = ({ data }: ReportProps) => {
    
    // Logica di Raggruppamento (Eseguita qui per isolamento)
    const grouped = (() => {
        const tree: any = {};
        
        // Ordina prima per severità globale (Blockers in cima)
        const sortedDetails = [...data.details].sort((a, b) => 
            SEVERITY_WEIGHT[b.migrationStatus] - SEVERITY_WEIGHT[a.migrationStatus]
        );

        sortedDetails.forEach(res => {
            const subName = res.subscriptionName || res.subscriptionId || "Unknown Subscription";
            
            if (!tree[res.subscriptionId]) {
                tree[res.subscriptionId] = { 
                    id: res.subscriptionId, 
                    name: subName, 
                    groups: {}, 
                    worstStatus: 'Ready' 
                };
            }
            
            const subNode = tree[res.subscriptionId];
            const rgName = res.resourceGroup || "Global / No-RG";
            
            if (!subNode.groups[rgName]) subNode.groups[rgName] = [];
            
            subNode.groups[rgName].push(res);
            
            // Calcolo worst status per Sub
            if (SEVERITY_WEIGHT[res.migrationStatus] > SEVERITY_WEIGHT[subNode.worstStatus]) {
                subNode.worstStatus = res.migrationStatus;
            }
        });
        
        // Ordina le Subscription per criticità
        return Object.values(tree).sort((a: any, b: any) => 
            SEVERITY_WEIGHT[b.worstStatus] - SEVERITY_WEIGHT[a.worstStatus]
        );
    })();

    return (
        <Document>
            <Page size="A4" style={styles.page} wrap>
                
                {/* HEADER */}
                <View style={styles.header}>
                    <Text style={styles.title}>Azure Migration Report</Text>
                    <Text style={styles.subtitle}>
                        Scenario: {data.scenario.toUpperCase()} {data.targetRegion ? `> ${data.targetRegion}` : ''}  |  Date: {new Date().toLocaleDateString()}
                    </Text>
                </View>

                {/* KPI SUMMARY */}
                <View style={styles.kpiContainer}>
                    <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Total Resources</Text><Text style={styles.kpiValue}>{data.summary.total}</Text></View>
                    <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Blockers</Text><Text style={{...styles.kpiValue, color: '#991B1B'}}>{data.summary.blockers}</Text></View>
                    <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Critical</Text><Text style={{...styles.kpiValue, color: '#DC2626'}}>{data.summary.critical}</Text></View>
                    <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Warnings</Text><Text style={{...styles.kpiValue, color: '#D97706'}}>{data.summary.warnings}</Text></View>
                    <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Ready</Text><Text style={{...styles.kpiValue, color: '#059669'}}>{data.summary.ready}</Text></View>
                </View>

                {/* LISTA SOTTOSCRIZIONI */}
                {grouped.map((sub: any) => (
                    <View key={sub.id} wrap={false} style={{marginBottom: 10}}>
                        
                        {/* Sub Header */}
                        <View style={styles.subHeader}>
                            <View>
                                <Text style={styles.subTitle}>SUBSCRIPTION: {sub.name}</Text>
                                <Text style={styles.subId}>{sub.id}</Text>
                            </View>
                            <Text style={{...styles.badge, backgroundColor: getStatusColor(sub.worstStatus)}}>{sub.worstStatus}</Text>
                        </View>

                        {/* LISTA RESOURCE GROUPS */}
                        {Object.keys(sub.groups).map((rgName) => (
                            <View key={rgName} style={styles.rgContainer} wrap={false}>
                                <View style={styles.rgHeader}>
                                    <Text style={styles.rgTitle}>RG: {rgName}</Text>
                                    <Text style={{fontSize: 8, color: '#6B7280'}}>{sub.groups[rgName].length} resources</Text>
                                </View>

                                {/* LISTA RISORSE */}
                                {sub.groups[rgName].map((res: Resource, idx: number) => (
                                    <View key={res.id} style={styles.resourceRow} wrap={false}>
                                        
                                        {/* Colonna 1: Nome & Dettagli */}
                                        <View style={styles.colName}>
                                            <Text style={styles.resName}>{res.name}</Text>
                                            <Text style={styles.resSubtext}>{res.location}</Text>
                                            
                                            {/* DETTAGLIO PROBLEMI */}
                                            {res.issues.length > 0 && (
                                                <View>
                                                    {res.issues.map((iss, i) => (
                                                        <View key={i} style={styles.issueContainer}>
                                                            <Text style={styles.issueTitle}>• {iss.message}</Text>
                                                            <Text style={styles.issueText}>Impact: {iss.impact}</Text>
                                                            {iss.workaround && (
                                                                <View style={styles.fixBox}>
                                                                    <Text style={styles.fixLabel}>$ ACTION:</Text>
                                                                    <Text style={styles.fixContent}>{iss.workaround}</Text>
                                                                </View>
                                                            )}
                                                        </View>
                                                    ))}
                                                </View>
                                            )}
                                        </View>
                                        
                                        {/* Colonna 2: Tipo Risorsa */}
                                        <View style={styles.colType}>
                                            <Text style={styles.resType}>{res.type}</Text>
                                            <Text style={{...styles.resSubtext, fontSize: 6, marginTop: 2, color: '#9CA3AF'}}>{res.id.split('/').pop()}</Text>
                                        </View>
                                        
                                        {/* Colonna 3: Stato */}
                                        <View style={styles.colStatus}>
                                            <Text style={{...styles.badge, backgroundColor: getStatusColor(res.migrationStatus)}}>{res.migrationStatus}</Text>
                                            {res.issues.some((i: any) => i.downtimeRisk) && (
                                                <Text style={{fontSize: 7, color: '#7C3AED', fontWeight: 'bold', marginTop: 4}}>⚡ Downtime</Text>
                                            )}
                                        </View>
                                    </View>
                                ))}
                            </View>
                        ))}
                    </View>
                ))}

                <Text style={styles.footer} render={({ pageNumber, totalPages }) => (
                    `Page ${pageNumber} of ${totalPages} - Azure Migration Analyzer Report`
                )} fixed />
            </Page>
        </Document>
    );
};