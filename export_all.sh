#!/bin/bash

CONTAINER="novostroyki-ai-postgres-1"
DB_USER="novostroyki"
DB_NAME="novostroyki"
OUT_DIR="/tmp/csv_dumps"

mkdir -p $OUT_DIR

tables=$(docker exec -i $CONTAINER psql -U $DB_USER -d $DB_NAME -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public';")

for table in $tables; do
  table=$(echo $table | xargs)

  if [ -n "$table" ]; then
    echo "Экспорт таблицы: $table ..."
    docker exec -i $CONTAINER psql -U $DB_USER -d $DB_NAME -c "COPY public.\"$table\" TO STDOUT CSV HEADER" > "$OUT_DIR/$table.csv"
  fi
done

echo "Готово! Все CSV лежат в папке: $OUT_DIR"
