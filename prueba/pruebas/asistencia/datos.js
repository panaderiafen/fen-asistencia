// Datos de prueba ficticios para Asistencia (mismas columnas que la planilla real).
'use strict';
const { Planilla, convertir } = require('../gas-mock');

function fila(valores) { return valores.map(v => convertir(v)); }

function hoyISO(offsetDias = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDias);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function planillaAsistencia() {
  const trabajadores = [
    ['correo', 'nombre', 'tipo', 'horasSemana', 'valorHora', 'activo', 'admin', 'pin', 'diasLaborales'],
    fila(['ana@prueba.cl', 'Ana Rojas', 'contrato', '44', '0', 'TRUE', 'FALSE', '1234', 'L-V']),
    fila(['beto@prueba.cl', 'Beto Soto', 'contrato', '30', '0', 'TRUE', 'FALSE', '0123', 'L-S']), // Sheets lo guardó como 123
    fila(['caro@prueba.cl', 'Carolina Díaz', 'BHE', '', '5200', 'TRUE', 'FALSE', '9876', '']),
    fila(['dani@prueba.cl', 'Daniel Pérez', 'contrato', '44', '0', 'TRUE', 'FALSE', '', 'L-V']),
    fila(['ex@prueba.cl', 'Ex Trabajador', 'contrato', '44', '0', 'FALSE', 'FALSE', '5555', 'L-V']),
    fila(['xss@prueba.cl', '<img src=x onerror="window.__xss=1">Malicioso', 'contrato', '20', '0', 'TRUE', 'FALSE', '4321', 'L-V']),
  ];
  const registros = [
    ['id', 'correo', 'nombre', 'fecha', 'entrada', 'salida', 'tipoJornada', 'horasTrabajadas', 'observacion', 'ingresadoPor'],
    fila(['1001', 'ana@prueba.cl', 'Ana Rojas', hoyISO(-2), '08:00', '17:00', 'ordinaria', '9.00', '', 'trabajador']),
    fila(['1002', 'ana@prueba.cl', 'Ana Rojas', hoyISO(-1), '08:00', '16:30', 'ordinaria', '8.50', '', 'trabajador']),
    fila(['1003', 'caro@prueba.cl', 'Carolina Díaz', hoyISO(-1), '09:00', '14:00', 'feriado', '5.00', '', 'trabajador']),
    fila(['1004', 'beto@prueba.cl', 'Beto Soto', hoyISO(0), '07:30', '', 'ordinaria', '', '', 'trabajador']),
  ];
  const feriados = [['fecha', 'descripcion'], fila([hoyISO(-1), 'Feriado de prueba'])];
  const bonos = [['fecha', 'email', 'nombre', 'monto', 'concepto', 'agregadoPor']];
  return new Planilla({ trabajadores, registros, feriados, bonos });
}

module.exports = { planillaAsistencia, hoyISO };
