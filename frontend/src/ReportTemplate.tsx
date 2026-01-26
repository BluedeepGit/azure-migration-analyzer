import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

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

// --- STILI PDF OTTIMIZZATI ---
const styles = StyleSheet.create({
    page: { 
        paddingTop: 35,
        paddingBottom: 65,
        paddingHorizontal: 35,
        fontFamily: 'Helvetica',
        fontSize: 10,
        color: '#333'
    },
    
    // Header
    headerContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
        borderBottomWidth: 2,
        borderBottomColor: '#1E3A8A',
        paddingBottom: 10
    },
    title: { fontSize: 20, color: '#1E3A8A', fontWeight: 'bold' },
    metaData: { fontSize: 8, color: '#6B7280', textAlign: 'right' },

    // KPI
    kpiContainer: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        marginBottom: 20, 
        backgroundColor: '#F3F4F6', 
        padding: 10, 
        borderRadius: 4 
    },
    kpiItem: { alignItems: 'center' },
    kpiLabel: { fontSize: 8, color: '#6B7280', textTransform: 'uppercase' },
    kpiVal: { fontSize: 12, fontWeight: 'bold', marginTop: 2 },
    
    // Gerarchia
    subHeader: {
        marginTop: 15,
        marginBottom: 5,
        padding: 6,
        backgroundColor: '#E0E7FF', // Blu chiaro
        borderLeftWidth: 4,
        borderLeftColor: '#1E40AF',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    subTitle: { fontSize: 11, fontWeight: 'bold', color: '#1E3A8A' },
    
    rgTitle: { 
        marginTop: 10, 
        marginBottom: 5, 
        fontSize: 9, 
        fontWeight: 'bold', 
        color: '#4B5563',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
        paddingBottom: 2
    },

    // Risorsa (Riga)
    resourceRow: {
        flexDirection: 'row',
        marginBottom: 8,
        padding: 5,
        backgroundColor: '#F9FAFB',
        borderBottomWidth: 0.5,
        borderBottomColor: '#D1D5DB'
    },
    colLeft: { width: '75%' },
    colRight: { width: '25%', alignItems: 'flex-end' },

    resName: { fontSize: 9, fontWeight: 'bold', color: '#111827' },
    resType: { fontSize: 8, color: '#6B7280', marginBottom: 2 },
    
    // Issues Box
    issueContainer: {
        marginTop: 4,
        padding: 4,
        backgroundColor: '#FEF2F2',
        borderLeftWidth: 2,
        borderLeftColor: '#DC2626'
    },
    issueText: { fontSize: 8, color: '#991B1B', marginBottom: 1 },
    fixLabel: { fontSize: 7, fontWeight: 'bold', color: '#059669' },
    fixText: { fontSize: 7, fontFamily: 'Courier', color: '#374151' },

    // Badges
    badge: {
        fontSize: 8,
        paddingVertical: 2,
        paddingHorizontal: 6,
        borderRadius: 2,
        color: 'white',
        fontWeight: 'bold',
        textAlign: 'center',
        width: 60
    },

    // Footer
    pageNumber: {
        position: 'absolute',
        fontSize: 8,
        bottom: 30,
        left: 0,
        right: 0,
        textAlign: 'center',
        color: 'grey',
    },
});

const getStatusColor = (status: string) => {
    switch (status) {
        case 'Blocker': return '#991B1B'; 
        case 'Critical': return '#DC2626';
        case 'Warning': return '#D97706';
        case 'Info': return '#2563EB';
        case 'Ready': return '#059669';
        default: return '#6B7280';
    }
};

const SEVERITY_WEIGHT: Record<string, number> = { 'Blocker': 5, 'Critical': 4, 'Warning': 3, 'Info': 2, 'Ready': 1 };

export const MigrationReport = ({ data }: ReportProps) => {
    
    const grouped = (() => {
        const tree: any = {};
        const sortedDetails = [...data.details].sort((a, b) => SEVERITY_WEIGHT[b.migrationStatus] - SEVERITY_WEIGHT[a.migrationStatus]);

        sortedDetails.forEach(res => {
            const subName = res.subscriptionName || res.subscriptionId;
            if (!tree[res.subscriptionId]) tree[res.subscriptionId] = { id: res.subscriptionId, name: subName, groups: {}, worstStatus: 'Ready' };
            const subNode = tree[res.subscriptionId];
            const rgName = res.resourceGroup || "No-RG";
            if (!subNode.groups[rgName]) subNode.groups[rgName] = [];
            subNode.groups[rgName].push(res);
            if (SEVERITY_WEIGHT[res.migrationStatus] > SEVERITY_WEIGHT[subNode.worstStatus]) subNode.worstStatus = res.migrationStatus;
        });
        return Object.values(tree).sort((a: any, b: any) => SEVERITY_WEIGHT[b.worstStatus] - SEVERITY_WEIGHT[a.worstStatus]);
    })();

    return (
        <Document>
            <Page style={styles.page}>
                
                {/* Header (Fisso su ogni pagina? No, solo prima. Per fisso usa fixed) */}
                <View style={styles.headerContainer}>
                    <View>
                        <Text style={styles.title}>Azure Migration Report</Text>
                        <Text style={{fontSize: 10, color: '#4B5563'}}>Scenario: {data.scenario}</Text>
                    </View>
                    <View>
                        <Text style={styles.metaData}>Date: {new Date().toLocaleDateString()}</Text>
                        <Text style={styles.metaData}>{data.targetRegion ? `Target: ${data.targetRegion}` : ''}</Text>
                    </View>
                </View>

                {/* KPI */}
                <View style={styles.kpiContainer}>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Total</Text><Text style={styles.kpiVal}>{data.summary.total}</Text></View>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Blockers</Text><Text style={{...styles.kpiVal, color: '#991B1B'}}>{data.summary.blockers}</Text></View>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Critical</Text><Text style={{...styles.kpiVal, color: '#DC2626'}}>{data.summary.critical}</Text></View>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Warnings</Text><Text style={{...styles.kpiVal, color: '#D97706'}}>{data.summary.warnings}</Text></View>
                    <View style={styles.kpiItem}><Text style={styles.kpiLabel}>Ready</Text><Text style={{...styles.kpiVal, color: '#059669'}}>{data.summary.ready}</Text></View>
                </View>

                {/* Content Loop */}
                {grouped.map((sub: any) => (
                    <View key={sub.id}>
                        {/* Subscription Header - Allow Break */}
                        <View style={styles.subHeader}>
                            <Text style={styles.subTitle}>SUB: {sub.name}</Text>
                            <Text style={{fontSize: 8, color: '#1E3A8A'}}>{sub.worstStatus}</Text>
                        </View>

                        {/* Resource Groups */}
                        {Object.keys(sub.groups).map((rgName) => (
                            <View key={rgName}>
                                <Text style={styles.rgTitle}>RG: {rgName}</Text>

                                {/* Resources List */}
                                {sub.groups[rgName].map((res: Resource) => (
                                    <View key={res.id} style={styles.resourceRow} wrap={false}> 
                                        {/* wrap={false} QUI è corretto: impedisce di spezzare una singola riga risorsa */}
                                        
                                        <View style={styles.colLeft}>
                                            <Text style={styles.resName}>{res.name}</Text>
                                            <Text style={styles.resType}>{res.type}</Text>
                                            
                                            {/* Issues */}
                                            {res.issues.map((iss, i) => (
                                                <View key={i} style={styles.issueContainer}>
                                                    <Text style={styles.issueText}>• {iss.message}</Text>
                                                    <Text style={{fontSize: 8, color: '#374151'}}>Impact: {iss.impact}</Text>
                                                    {iss.workaround && (
                                                        <Text style={styles.fixText}><Text style={styles.fixLabel}>FIX: </Text>{iss.workaround}</Text>
                                                    )}
                                                </View>
                                            ))}
                                        </View>

                                        <View style={styles.colRight}>
                                            <Text style={{...styles.badge, backgroundColor: getStatusColor(res.migrationStatus)}}>{res.migrationStatus}</Text>
                                            <Text style={{fontSize: 8, color: '#9CA3AF', marginTop: 4}}>{res.location}</Text>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        ))}
                    </View>
                ))}

                <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => (
                    `${pageNumber} / ${totalPages}`
                )} fixed />
            </Page>
        </Document>
    );
};