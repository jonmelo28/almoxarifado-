CREATE TABLE sequencias_materiais (
 id TINYINT UNSIGNED PRIMARY KEY,
 ultimo_codigo DECIMAL(60,0) NOT NULL
) ENGINE=InnoDB;
INSERT INTO sequencias_materiais (id,ultimo_codigo)
SELECT 1,COALESCE(MAX(CAST(codigo AS DECIMAL(60,0))),0)
FROM materiais WHERE codigo REGEXP '^[0-9]+$';
