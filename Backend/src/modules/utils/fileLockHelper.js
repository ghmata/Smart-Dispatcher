const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Utilitário para lidar com operações de arquivo seguras em Windows,
 * com retries automáticos para erros de bloqueio (stat, read, write, rename).
 */
class FileLockHelper {
    
    /**
     * Tenta ler e fazer parse de um JSON com retries para EBUSY.
     * @param {string} filePath 
     * @param {number} retries 
     * @param {number} delay 
     * @returns {Promise<object|null>} Objeto parseado ou null se falhar/não existir
     */
    static async safeReadJson(filePath, retries = 5, delay = 500) {
        for (let i = 0; i < retries; i++) {
            try {
                if (!fs.existsSync(filePath)) return null;
                
                const content = fs.readFileSync(filePath, 'utf8');
                if (!content || content.trim().length === 0) {
                    throw new Error('Empty file');
                }
                
                try {
                    return JSON.parse(content);
                } catch (parseErr) {
                    throw new Error(`JSON Parse Error: ${parseErr.message}`);
                }

            } catch (err) {
                // Se for erro de parse ou arquivo vazio, não adianta tentar de novo (exceto se estiver sendo escrito agora)
                // Mas EBUSY/EPERM vale a pena tentar
                const isLockError = err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES';
                
                if (i === retries - 1) { // Última tentativa
                    logger.warn(`SafeReadJson falhou final para ${filePath}: ${err.message}`);
                    throw err; 
                }

                if (isLockError) {
                    logger.debug(`File locked (${err.code}), retrying read ${i+1}/${retries}...`);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    // Se for erro lógico (JSON inválido), retorna erro imediatamente para ser tratado pela quarentena
                    throw err;
                }
            }
        }
        return null;
    }

    /**
     * Move um diretório de forma segura (Rename com fallback).
     * @param {string} source 
     * @param {string} destination 
     */
    static async safeMove(source, destination) {
        try {
            // Garante que o pai do destino existe
            const destParent = path.dirname(destination);
            if (!fs.existsSync(destParent)) {
                fs.mkdirSync(destParent, { recursive: true });
            }

            // Tenta rename (rápido)
            fs.renameSync(source, destination);
            return true;
        } catch (err) {
            logger.warn(`Move (Rename) failed: ${err.message}. Trying copy+delete...`);
            
            // Fallback: Copy + Remove (Robocopy style simplificado)
            try {
                fs.cpSync(source, destination, { recursive: true });
                fs.rmSync(source, { recursive: true, force: true });
                return true;
            } catch (copyErr) {
                logger.error(`SafeMove completely failed for ${source}: ${copyErr.message}`);
                return false;
            }
        }
    }
}

module.exports = FileLockHelper;
