import * as XLSX from 'xlsx'

export function generateExcel(invoices) {
  const wb = XLSX.utils.book_new()

  const headers = ['File Name', 'Sub-Total', 'Total Freight', 'Tax', 'Discount (5%)', 'Original Amount Due', 'New Amount Due', 'Confidence', 'Error']

  const rows = invoices.map((inv) => [
    inv.fileName,
    inv.subTotal ?? '',
    inv.totalFreight ?? '',
    inv.tax ?? '',
    inv.discount ?? '',
    inv.originalAmountDue ?? '',
    inv.newAmountDue ?? '',
    inv.extractionConfidence,
    inv.error ?? '',
  ])

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!cols'] = [{ wch: 35 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 30 }]

  const currencyFmt = '"$"#,##0.00'
  const currencyCols = [1, 2, 3, 4, 5, 6]
  invoices.forEach((_, rowIdx) => {
    const excelRow = 2 + rowIdx
    currencyCols.forEach((colIdx) => {
      const cellRef = XLSX.utils.encode_cell({ r: excelRow - 1, c: colIdx })
      if (ws[cellRef] && ws[cellRef].v !== '') {
        ws[cellRef].t = 'n'
        ws[cellRef].z = currencyFmt
      }
    })
  })

  XLSX.utils.book_append_sheet(wb, ws, 'Invoice Discounts')

  const summaryData = [
    ['Invoice Discount Summary'],
    [''],
    ['Total Invoices Processed', invoices.length],
    ['Successful Extractions', invoices.filter((i) => i.error === null).length],
    ['Failed Extractions', invoices.filter((i) => i.error !== null).length],
    [''],
    ['Total Sub-Total', invoices.reduce((s, i) => s + (i.subTotal ?? 0), 0)],
    ['Total Discount Applied', invoices.reduce((s, i) => s + (i.discount ?? 0), 0)],
    ['Total Original Amount Due', invoices.reduce((s, i) => s + (i.originalAmountDue ?? 0), 0)],
    ['Total New Amount Due', invoices.reduce((s, i) => s + (i.newAmountDue ?? 0), 0)],
    [''],
    ['Discount Rate', '5%'],
    ['Generated', new Date().toLocaleString()],
  ]

  const ws2 = XLSX.utils.aoa_to_sheet(summaryData)
  ws2['!cols'] = [{ wch: 30 }, { wch: 20 }]

  const summaryNumRows = [6, 7, 8, 9]
  summaryNumRows.forEach((rowIdx) => {
    const cellRef = XLSX.utils.encode_cell({ r: rowIdx, c: 1 })
    if (ws2[cellRef] && typeof ws2[cellRef].v === 'number') {
      ws2[cellRef].t = 'n'
      ws2[cellRef].z = currencyFmt
    }
  })

  XLSX.utils.book_append_sheet(wb, ws2, 'Summary')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}