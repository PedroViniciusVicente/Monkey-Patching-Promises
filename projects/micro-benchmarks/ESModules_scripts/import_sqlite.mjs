// import_sqlite.mjs - npm i sqlite sqlite3
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

/* 
** Linhas com operações assincronas: 13
** 21 - await open
** 26 - await db.exec
** 38 - await db.run x2
** 46 - await db.all
** 51 - await db.get
** 56 - await conectarBanco
** 58 - await cadastrarProduto
** 59 - await cadastrarProduto
** 61 - await listarProdutos
** 65 - await buscarProdutoPorId
** 69 - await db.close
** 72 - await main
*/
async function conectarBanco() {
  const db = await open({ // [REGISTRAR] Abertura assíncrona de conexão com DB
    filename: './dados_locais.db',
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      preco REAL NOT NULL
    )
  `); // [REGISTRAR (Linha 26)] Execução assíncrona de DDL SQL

  return db;
}

async function cadastrarProduto(db, nome, preco) {
  const resultado = await db.run(
    'INSERT INTO produtos (nome, preco) VALUES (?, ?)',
    [nome, preco]
  ); // [REGISTRAR (Linha 38)] x2 Inserção/Escrita assíncrona SQL
  return resultado.lastID;
}

async function listarProdutos(db) {
  const produtos = await db.all('SELECT * FROM produtos'); // [REGISTRAR] Consulta assíncrona SQL de múltiplos registros
  return produtos;
}

async function buscarProdutoPorId(db, id) {
  const produto = await db.get('SELECT * FROM produtos WHERE id = ?', [id]); // [REGISTRAR] Consulta assíncrona SQL de registro único
  return produto;
}

async function main() {
  const db = await conectarBanco(); // [REGISTRAR] Chamada assíncrona de conexão

  await cadastrarProduto(db, 'Teclado Mecânico', 250.0); // [REGISTRAR] Chamada assíncrona de escrita
  await cadastrarProduto(db, 'Mouse Sem Fio', 120.5); // [REGISTRAR] Chamada assíncrona de escrita

  const lista = await listarProdutos(db); // [REGISTRAR] Chamada assíncrona de leitura
  console.log('Produtos cadastrados:', lista);

  if (lista.length > 0) {
    const item = await buscarProdutoPorId(db, lista[0].id); // [REGISTRAR] Chamada assíncrona de leitura isolada
    console.log('Detalhes do primeiro produto:', item);
  }

  await db.close(); // [REGISTRAR] Fechamento assíncrono de conexão
}

await main(); // [REGISTRAR] Top-level await