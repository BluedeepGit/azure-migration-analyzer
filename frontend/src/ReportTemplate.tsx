import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';

// Tipi (Duplicati parzialmente per mantenere il file indipendente)
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

// Stili PDF
const styles = StyleSheet.create({
    page: { padding: 30, backgroundColor: '#FFFFFF', fontFamily: 'Helvetica' },
    header: { marginBottom: 20, borderBottomWidth: 2, borderBottomColor: '#1E3A8A', paddingBottom: 10 },
    title: { fontSize: 24, color: '#1E3A8A', fontWeight: 'bold' },
    subtitle: { fontSize: 10, color: '#6B7280', marginTop: 4 },
    
    // KPI Section
    kpiContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, backgroundColor: '#F3F4F6', padding: 10, borderRadius: 4 },
    kpiBox: { alignItems: 'center' },
    kpiLabel: { fontSize: 8, color: '#6B7280', textTransform: 'uppercase' },
    kpiValue: { fontSize: 14, fontWeight: 'bold', color: '#111827' },
    
    // Hierarchy
    subHeader: { marginTop: 15, marginBottom: 5, padding: 6, backgroundColor: '#EFF6FF', flexDirection: 'row', justifyContent: 'space-between' },
    subTitle: { fontSize: 12, fontWeight: 'bold', color: '#1E40AF' },
    rgHeader: { marginTop: 8, marginBottom: 4, marginLeft: 10, flexDirection: 'row', alignItems: 'center' },
    rgTitle: { fontSize: 10, fontWeight: 'bold', color: '#374151' },
    
    // Resource Table
    row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', paddingVertical: 6, marginLeft: 15 },
    colName: { width: '40%' },
    colType: { width: '30%' },
    colStatus: { width: '30%', alignItems: 'flex-end' },
    
    textBold: { fontSize: 9, fontWeight: 'bold', color: '#374151' },
    textSmall: { fontSize: 8, color: '#6B7280' },
    textTiny: { fontSize: 7, color: '#9CA3AF' },
    
    // Issues
    issueBox: { marginTop: 4, padding: 4, backgroundColor: '#FEF2F2', borderRadius: 2, marginLeft: 15 },
    issueText: { fontSize: 8, color: '#991B1B' },
    fixText: { fontSize: 7, color: '#1F2937', marginTop: 2, fontFamily: 'Courier' },

    // Badges
    badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontSize: 8, fontWeight: 'bold', color: 'white' },
});

const getStatusColor = (status: string) => {
    switch (status) {
        case 'Blocker': return '#991B1B'; // Red 800
        case 'Critical': return '#DC2626'; // Red 600
        case 'Warning': return '#D97706'; // Orange
        case 'Ready': return '#059669';   // Green
        default: return '#2563EB';        // Blue
    }
};

const SEVERITY_WEIGHT: Record<string, number> = { 'Blocker': 5, 'Critical': 4, 'Warning': 3, 'Info': 2, 'Ready': 1 };

export const MigrationReport = ({ data }: ReportProps) => {
    
    // Logica di Raggruppamento (Replicata qui per indipendenza)
    const grouped = (() => {
        const tree: any = {};
        data.details.forEach(res => {
            const subName = res.subscriptionName || res.subscriptionId;
            if (!tree[res.subscriptionId]) tree[res.subscriptionId] = { id: res.subscriptionId, name: subName, groups: {}, worstStatus: 'Ready' };
            
            const subNode = tree[res.subscriptionId];
            const rgName = res.resourceGroup || "No-RG";
            if (!subNode.groups[rgName]) subNode.groups[rgName] = [];
            
            subNode.groups[rgName].push(res);
            
            if (SEVERITY_WEIGHT[res.migrationStatus] > SEVERITY_WEIGHT[subNode.worstStatus]) subNode.worstStatus = res.migrationStatus;
        });
        return Object.values(tree);
    })();

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                
                {/* HEADER */}
                <View style={styles.header}>
                    <Text style={styles.title}>Azure Migration Report</Text>
                    <Text style={styles.subtitle}>Scenario: {data.scenario} {data.targetRegion ? `-> ${data.targetRegion}` : ''} | Generato il: {new Date().toLocaleDateString()}</Text>
                </View>

                {/* KPI SUMMARY */}
                <View style={styles.kpiContainer}>
                    <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Total</Text><Text style={styles.kpiValue}>{data.summary.total}</Text></View>
                    <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Blockers</Text><Text style={{...styles.kpiValue, color: '#991B1B'}}>{data.summary.blockers}</Text></View>
                    <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Critical</Text><Text style={{...styles.kpiValue, color: '#DC2626'}}>{data.summary.critical}</Text></View>
                    <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Warnings</Text><Text style={{...styles.kpiValue, color: '#D97706'}}>{data.summary.warnings}</Text></View>
                    <View style={styles.kpiBox}><Text style={styles.kpiLabel}>Ready</Text><Text style={{...styles.kpiValue, color: '#059669'}}>{data.summary.ready}</Text></View>
                </View>

                {/* DETAILS */}
                {grouped.map((sub: any) => (
                    <View key={sub.id} wrap={false}>
                        {/* SUBSCRIPTION HEADER */}
                        <View style={styles.subHeader}>
                            <View>
                                <Text style={styles.subTitle}>SUB: {sub.name}</Text>
                                <Text style={styles.textTiny}>{sub.id}</Text>
                            </View>
                            <Text style={{...styles.badge, backgroundColor: getStatusColor(sub.worstStatus)}}>{sub.worstStatus}</Text>
                        </View>

                        {/* RESOURCE GROUPS */}
                        {Object.keys(sub.groups).map((rgName) => (
                            <View key={rgName} style={{marginBottom: 10}}>
                                <View style={styles.rgHeader}>
                                    <Text style={styles.rgTitle}>RG: {rgName}</Text>
                                </View>

                                {/* RESOURCES LIST */}
                                {sub.groups[rgName].map((res: Resource) => (
                                    <View key={res.id} style={styles.row} wrap={false}>
                                        <View style={styles.colName}>
                                            <Text style={styles.textBold}>{res.name}</Text>
                                            <Text style={styles.textTiny}>{res.location}</Text>
                                            
                                            {/* ISSUES BLOCK */}
                                            {res.issues.length > 0 && res.issues.map((iss, idx) => (
                                                <View key={idx} style={styles.issueBox}>
                                                    <Text style={styles.issueText}>• {iss.message}</Text>
                                                    <Text style={styles.textTiny}>{iss.impact}</Text>
                                                    <Text style={styles.fixText}>FIX: {iss.workaround}</Text>
                                                </View>
                                            ))}
                                        </View>
                                        
                                        <View style={styles.colType}>
                                            <Text style={styles.textSmall}>{res.type.split('/').pop()}</Text>
                                        </View>
                                        
                                        <View style={styles.colStatus}>
                                            <Text style={{...styles.badge, backgroundColor: getStatusColor(res.migrationStatus)}}>{res.migrationStatus}</Text>
                                            {res.issues.some((i: any) => i.downtimeRisk) && <Text style={{fontSize: 7, color: '#7C3AED', marginTop: 2}}>⚡ Downtime Risk</Text>}
                                        </View>
                                    </View>
                                ))}
                            </View>
                        ))}
                    </View>
                ))}
                
                <Text style={{position: 'absolute', bottom: 30, left: 0, right: 0, textAlign: 'center', fontSize: 8, color: '#9CA3AF'}} render={({ pageNumber, totalPages }) => (
                    `${pageNumber} / ${totalPages}`
                )} fixed />
            </Page>
        </Document>
    );
};