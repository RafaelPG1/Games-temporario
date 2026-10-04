import os

# Pergunta apenas o nome do jogo diretamente no terminal
print("Criado de pasta e arquivos")
nome = input("Nome: ")

if nome:
    # Remove espaços extras nas pontas
    nome = nome.strip()

    # Cria a pasta com o nome informado
    os.makedirs(nome, exist_ok=True)

    # Cria os arquivos .html, .css e .js com o mesmo nome
    for ext in [".html", ".css", ".js"]:
        caminho = os.path.join(nome, f"{nome}{ext}")
        if not os.path.exists(caminho):
            with open(caminho, "w", encoding="utf-8") as f:
                pass

    # Exibe a mensagem de sucesso no terminal
    print("\nCriado com sucesso!\n")
    print(f"📁 {nome}/")
    print(f" ├── {nome}.html")
    print(f" ├── {nome}.css")
    print(f" └── {nome}.js")