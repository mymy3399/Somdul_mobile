#!/bin/bash

# Configuration
CONTAINER_NAME="somdul-db"
DB_USER="somdul"
DB_NAME="somdul"
BACKUP_DIR="/root/somdul/backend/backups"

mkdir -p "$BACKUP_DIR"

show_help() {
    echo "Somdul Database Backup & Restore Tool"
    echo "Usage:"
    echo "  $0 backup          - Take a database snapshot"
    echo "  $0 restore         - List backups and restore one interactively"
    echo "  $0 list            - List all available backups"
}

do_backup() {
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    FILE_PATH="$BACKUP_DIR/backup_$TIMESTAMP.sql"
    echo "Starting backup of database '$DB_NAME'..."
    
    if ! docker ps | grep -q "$CONTAINER_NAME"; then
        echo "Error: Database container '$CONTAINER_NAME' is not running!"
        exit 1
    fi
    
    docker exec -t "$CONTAINER_NAME" pg_dump -U "$DB_USER" "$DB_NAME" > "$FILE_PATH"
    
    if [ $? -eq 0 ]; then
        echo "Backup successfully created: $FILE_PATH"
    else
        echo "Error: Backup failed!"
        exit 1
    fi
}

do_list() {
    echo "Available Backups:"
    ls -lh "$BACKUP_DIR"/*.sql 2>/dev/null || echo "No backups found."
}

do_restore() {
    echo "Scanning available backups..."
    backups=($(ls -1 "$BACKUP_DIR"/*.sql 2>/dev/null))
    
    if [ ${#backups[@]} -eq 0 ]; then
        echo "Error: No backup files found in $BACKUP_DIR"
        exit 1
    fi
    
    echo "Select a backup file to restore:"
    for i in "${!backups[@]}"; do
        echo "  [$i] $(basename "${backups[$i]}") ($(du -h "${backups[$i]}" | cut -f1))"
    done
    
    read -p "Enter backup index to restore (0-$(( ${#backups[@]} - 1 ))): " idx
    
    if [[ ! "$idx" =~ ^[0-9]+$ ]] || [ "$idx" -lt 0 ] || [ "$idx" -ge "${#backups[@]}" ]; then
        echo "Error: Invalid selection!"
        exit 1
    fi
    
    SELECTED_FILE="${backups[$idx]}"
    echo "Restoring database from: $SELECTED_FILE..."
    
    if ! docker ps | grep -q "$CONTAINER_NAME"; then
        echo "Error: Database container '$CONTAINER_NAME' is not running!"
        exit 1
    fi
    
    # Terminate active connections to allow db drop/recreate
    docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d postgres -c "SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = '$DB_NAME' AND pid <> pg_backend_pid();" > /dev/null
    
    # Drop and recreate database inside the container
    docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" > /dev/null
    docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME WITH OWNER=$DB_USER;" > /dev/null
    
    # Restore the schema and data
    cat "$SELECTED_FILE" | docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" > /dev/null
    
    if [ $? -eq 0 ]; then
        echo "Database successfully restored from $SELECTED_FILE!"
        echo "Please restart the backend service to clear connections cache: systemctl restart somdul"
    else
        echo "Error: Restore failed!"
        exit 1
    fi
}

case "$1" in
    backup)
        do_backup
        ;;
    restore)
        do_restore
        ;;
    list)
        do_list
        ;;
    *)
        show_help
        ;;
esac
