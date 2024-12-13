import express from "express";
import jwt from "jsonwebtoken";
import { Sequelize, DataTypes } from "sequelize";
import fs from "fs";
import http from "http";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import cors from "cors";
import stripe from 'stripe';
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url"; // Import necesario para __dirname en ES6

dotenv.config();

const app = express();
//const hostname = "127.0.0.1";
const hostname = "192.168.137.114";
const PORT = 3000;

// Configuración de CORS
const corsOptions = {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://192.168.0.5', 'http://192.68.0.6'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Authorization'],
    credentials: true,
    maxAge: 86400
};
app.use(cors());
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
// Servir la carpeta de imágenes como recurso estático
// Definir manualmente __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Usar __dirname para configurar la ruta de archivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));



// Conexión a la base de datos MySQL
const sequelize = new Sequelize("prueba1", "root", "", {
    host: "localhost",
    dialect: "mysql",
});


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Carpeta donde se guardarán las imágenes
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
    },
});
const upload = multer({ storage });


if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Verifica la conexión
sequelize.authenticate()
    .then(() => console.log("Conectado a MySQL"))
    .catch(err => console.error("No se pudo conectar a MySQL:", err));

// Modelo de Usuario
const User = sequelize.define("User", {
    nombre: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    telefono: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },
});


// Modelo de Categoría de Artesanía
const CraftCategory = sequelize.define("CraftCategory", {
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
});


//artesanias 

const Craft = sequelize.define("Craft", {
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    price: {
        type: DataTypes.FLOAT,
        allowNull: false,
    },
    stock: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    image: {
        type: DataTypes.STRING, // Guardará la URL de la imagen
        allowNull: true,
    },
    categoryId: { // Clave foránea explícita
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: CraftCategory, // Nombre del modelo de referencia
            key: 'id', // Clave primaria de la tabla CraftCategory
        },
        onUpdate: 'CASCADE', // Opcional: comportamiento al actualizar/eliminar
        onDelete: 'CASCADE',
    },
});




// Relación entre Artesanías y Categorías
Craft.belongsTo(CraftCategory, { foreignKey: "categoryId" });
CraftCategory.hasMany(Craft, { foreignKey: "categoryId" });



// Modelo de Rol
const Role = sequelize.define("Role", {
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
});
// Relación entre Usuario y Rol
User.belongsTo(Role, { foreignKey: "roleId" });
Role.hasMany(User, { foreignKey: "roleId" });


const Sale = sequelize.define("Sale", {
    craftName: {
        type: DataTypes.STRING,
        allowNull: false, // No se permite que sea nulo
    },
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false, // No se permite que sea nulo
    },
    totalPrice: {
        type: DataTypes.FLOAT,
        allowNull: false, // No se permite que sea nulo
    },
});

// Relación entre Venta y Artesanía
Sale.belongsTo(Craft, { foreignKey: "craftId" });
Craft.hasMany(Sale, { foreignKey: "craftId" });

// Relación entre Venta y Usuario (Cliente)
Sale.belongsTo(User, { foreignKey: "userId" });
User.hasMany(Sale, { foreignKey: "userId" });


// Sincroniza los modelos con la base de datos
sequelize.sync({ force: false}) // Cambia `force` a `true` solo si deseas sobrescribir tablas existentes
    .then(async () => {
        console.log("Base de datos sincronizada");

        // Crear roles iniciales si no existen
        const roles = ["Administrador", "Cliente"];
        for (const roleName of roles) {
            const role = await Role.findOne({ where: { name: roleName } });
            if (!role) {
                await Role.create({ name: roleName });
                console.log(`Rol creado: ${roleName}`);
            }
        }

        // Crear usuario administrador predeterminado
        const adminRole = await Role.findOne({ where: { name: "Administrador" } });
        const hashedPassword = await bcrypt.hash("12345", 10);

        const adminUser = await User.findOne({ where: { telefono: "9515079444" } });
        if (!adminUser) {
            await User.create({
                nombre: "Administrador",
                telefono: "9515079444",
                password: hashedPassword,
                roleId: adminRole.id, // Asignar el rol de Administrador
            });
            console.log("Usuario administrador predeterminado creado.");
        }
    })
    .catch(err => console.error("Error al sincronizar la base de datos:", err));


const server = http.createServer(app);

// Middleware de autenticación JWT
const authenticateJWT = (req, res, next) => {
    const token = req.headers["authorization"]?.split(" ")[1];
    if (!token) {
        return res.status(403).json({ error: "Token no proporcionado" });
    }

    jwt.verify(token, process.env.SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: "Token inválido" });
        }
        req.user = user;
        next();
    });
};

// Middleware de manejo de errores CORS
app.use((err, req, res, next) => {
    if (err.name === 'UnauthorizedError') {
        res.status(401).json({ error: 'Token inválido' });
    } else if (err.name === 'NotAllowedError') {
        res.status(403).json({ error: 'CORS no permitido' });
    } else {
        next(err);
    }
});

// Ruta principal
app.get("/", (req, res) => {
    res.send("API Artesanías - Ruta principal");
});

// Rutas de Usuarios
// Ruta para registrar nuevos usuarios con rol de Cliente
// Rutas de Usuarios

// Ruta para registrar nuevos usuarios con rol de Cliente
app.post("/api/users/register", async (req, res) => {
    try {
        const { nombre, telefono, password } = req.body;
        if (!nombre || !telefono || !password) {
            return res.status(400).json({ error: "Faltan campos requeridos" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Asignar rol de cliente
        const clientRole = await Role.findOne({ where: { name: "Cliente" } });
        if (!clientRole) {
            return res.status(500).json({ error: "Rol de cliente no encontrado" });
        }

        // Crear el usuario con rol de Cliente
        const newUser = await User.create({
            nombre,
            telefono,
            password: hashedPassword,
            roleId: clientRole.id, // Asignar rol de Cliente
        });

        const token = jwt.sign({ id: newUser.id }, process.env.SECRET, { expiresIn: "1h" });
        res.status(201).json({
            message: "Usuario registrado exitosamente",
            user: {
                id: newUser.id,
                nombre: newUser.nombre,
                telefono: newUser.telefono,
            },
            token,
        });
    } catch (error) {
        console.error("Error en el registro:", error);
        res.status(400).json({ error: "Error al registrar usuario" });
    }
});

// Ruta para iniciar sesión
app.post("/api/users/login", async (req, res) => {
    try {
        const { nombre, telefono, password } = req.body;

        if (!nombre || !telefono || !password) {
            return res.status(400).json({ error: "Faltan campos requeridos" });
        }

        const user = await User.findOne({ where: { nombre, telefono }, include: Role });

        if (!user) {
            return res.status(401).json({ error: "Credenciales inválidas" });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ error: "Credenciales inválidas" });
        }

        const token = jwt.sign({ id: user.id }, process.env.SECRET, { expiresIn: "1h" });

        res.json({
            message: "Inicio de sesión exitoso",
            user: {
                id: user.id,
                nombre: user.nombre,
                telefono: user.telefono,
                rol: user.Role.name,
            },
            token,
        });
    } catch (error) {
        console.error("Error en el login:", error);
        res.status(500).json({ error: "Error en el login" });
    }
});

// Ruta para obtener el perfil del usuario logeado
app.get("/api/users/me", authenticateJWT, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: ["id", "nombre", "telefono"],
            include: { model: Role, attributes: ["name"] },
        });

        if (!user) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        res.json({
            id: user.id,
            nombre: user.nombre,
            telefono: user.telefono,
            rol: user.Role.name,
        });
    } catch (error) {
        console.error("Error al obtener el perfil del usuario:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});


app.get("/api/users", async (req, res) => {
    try {
        const users = await User.findAll({
            include: { model: Role, attributes: ["name"] },
        });
        res.json(users);
    } catch (error) {
        console.error("Error al obtener usuarios:", error);
        res.status(500).json({ error: "Error al obtener usuarios" });
    }
});


app.get("/api/users/profile", authenticateJWT, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener el perfil" });
    }
});

app.put("/api/users/profile", authenticateJWT, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }
        user.nombre = req.body.nombre;
        user.telefono = req.body.telefono;
        await user.save();
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: "Error al actualizar el perfil" });
    }
});

app.delete("/api/users/profile", authenticateJWT, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }
        await user.destroy();
        res.json({ message: "Usuario eliminado con éxito" });
    } catch (error) {
        res.status(500).json({ error: "Error al eliminar el usuario" });
    }
});

// Rutas de Artesanías
app.get("/api/crafts", async (req, res) => {
    try {
        const crafts = await Craft.findAll({
            include: [{ model: CraftCategory, attributes: ["id", "title"] }], // Incluye los datos de la categoría
        });
        res.json(crafts);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener artesanías" });
    }
});

app.post("/api/crafts", authenticateJWT, upload.single("image"), async (req, res) => {
    try {
        const { title, description, price, stock, categoryId } = req.body;

        // Validar si se envió un archivo
        const image = req.file ? `/uploads/${req.file.filename}` : null;

        const newCraft = await Craft.create({
            title,
            description,
            price: parseFloat(price),
            stock: parseInt(stock),
            image,
            categoryId, // Asocia la categoría seleccionada
        });

        res.status(201).json(newCraft);
    } catch (error) {
        console.error(error);
        res.status(400).json({ error: "Error al crear artesanía" });
    }
});

app.put("/api/crafts/:id", authenticateJWT, upload.single("image"), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, price, stock, categoryId } = req.body;

        // Buscar la artesanía por ID
        const craft = await Craft.findByPk(id);
        if (!craft) {
            return res.status(404).json({ error: "Artesanía no encontrada" });
        }

        // Actualizar los campos enviados en el cuerpo
        craft.title = title;
        craft.description = description;
        craft.price = parseFloat(price);
        craft.stock = parseInt(stock);
        craft.categoryId = categoryId;

        // Actualizar la imagen solo si se envió una nueva
        if (req.file) {
            craft.image = `/uploads/${req.file.filename}`;
        }

        // Guardar los cambios en la base de datos
        await craft.save();

        res.json(craft);
    } catch (error) {
        console.error("Error al actualizar la artesanía:", error);
        res.status(500).json({ error: "Error al actualizar artesanía" });
    }
});


app.get("/api/crafts/:id", async (req, res) => {
    try {
        const craft = await Craft.findByPk(req.params.id);
        if (!craft) return res.status(404).json({ error: "Artesanía no encontrada" });
        res.json(craft);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener artesanía" });
    }
});

app.delete("/api/crafts/:id", authenticateJWT, async (req, res) => {
    try {
        const craft = await Craft.findByPk(req.params.id);
        if (!craft) return res.status(404).json({ error: "Artesanía no encontrada" });
        await craft.destroy();
        res.json({ message: "Artesanía eliminada con éxito" });
    } catch (error) {
        res.status(500).json({ error: "Error al eliminar artesanía" });
    }
});


// Rutas de Categorías
app.get("/api/categories", async (req, res) => {
    try {
        const categories = await CraftCategory.findAll();
        res.json(categories);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener categorías" });
    }
});

app.post("/api/categories", authenticateJWT, async (req, res) => {
    try {
        const { title, description } = req.body;
        const newCategory = await CraftCategory.create({ title, description });
        res.status(201).json(newCategory);
    } catch (error) {
        res.status(400).json({ error: "Error al crear categoría" });
    }
});

app.get("/api/categories/:id", async (req, res) => {
    try {
        const category = await CraftCategory.findByPk(req.params.id);
        if (!category) return res.status(404).json({ error: "Categoría no encontrada" });
        res.json(category);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener categoría" });
    }
});

app.put("/api/categories/:id", authenticateJWT, async (req, res) => {
    try {
        const { title, description } = req.body;
        const category = await CraftCategory.findByPk(req.params.id);
        if (!category) return res.status(404).json({ error: "Categoría no encontrada" });

        category.title = title;
        category.description = description;
        await category.save();
        res.json(category);
    } catch (error) {
        res.status(400).json({ error: "Error al actualizar categoría" });
    }
});

app.delete("/api/categories/:id", authenticateJWT, async (req, res) => {
    try {
        const category = await CraftCategory.findByPk(req.params.id);
        if (!category) return res.status(404).json({ error: "Categoría no encontrada" });
        await category.destroy();
        res.json({ message: "Categoría eliminada con éxito" });
    } catch (error) {
        res.status(500).json({ error: "Error al eliminar categoría" });
    }
});

//ventas
app.post("/api/sales", authenticateJWT, async (req, res) => {
    try {
        const { craftId, quantity } = req.body;

        // Verificar si la artesanía existe
        const craft = await Craft.findByPk(craftId);
        if (!craft) {
            return res.status(404).json({ error: "Artesanía no encontrada" });
        }

        // Validar cantidad y stock
        if (craft.stock < quantity) {
            return res.status(400).json({ error: "Stock insuficiente para realizar la venta" });
        }

        // Calcular el total
        const totalPrice = craft.price * quantity;

        // Actualizar el stock de la artesanía
        craft.stock -= quantity;
        await craft.save();

        // Registrar la venta
        const sale = await Sale.create({
            craftName: craft.title,
            quantity,
            totalPrice,
            craftId,
            userId: req.user.id, // Asociar la venta al usuario autenticado
        });

        res.status(201).json({
            message: "Venta registrada exitosamente",
            sale,
        });
    } catch (error) {
        console.error("Error al crear la venta:", error);
        res.status(500).json({ error: "Error al registrar la venta" });
    }
});

app.get("/api/sales", authenticateJWT, async (req, res) => {
    try {
        const sales = await Sale.findAll({
            where: { userId: req.user.id }, // Filtrar por usuario autenticado
            include: [
                {
                    model: Craft,
                    attributes: ["id", "title", "price"],
                },
            ],
        });
        res.json(sales);
    } catch (error) {
        console.error("Error al obtener las ventas:", error);
        res.status(500).json({ error: "Error al obtener las ventas" });
    }
});


app.put("/api/sales/:id", authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity } = req.body;

        const sale = await Sale.findByPk(id);
        if (!sale) {
            return res.status(404).json({ error: "Venta no encontrada" });
        }

        const craft = await Craft.findByPk(sale.craftId);
        if (!craft) {
            return res.status(404).json({ error: "Artesanía no encontrada" });
        }

        // Calcular la diferencia en cantidad
        const quantityDifference = quantity - sale.quantity;

        // Validar stock si se aumenta la cantidad
        if (quantityDifference > 0 && craft.stock < quantityDifference) {
            return res.status(400).json({ error: "Stock insuficiente para ajustar la venta" });
        }

        // Ajustar el stock de la artesanía
        craft.stock -= quantityDifference;
        await craft.save();

        // Actualizar la venta
        sale.quantity = quantity;
        sale.totalPrice = quantity * craft.price; // Recalcular el precio total
        await sale.save();

        res.json({
            message: "Venta actualizada exitosamente",
            sale,
        });
    } catch (error) {
        console.error("Error al actualizar la venta:", error);
        res.status(500).json({ error: "Error al actualizar la venta" });
    }
});


app.delete("/api/sales/:id", authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;

        const sale = await Sale.findByPk(id);
        if (!sale) {
            return res.status(404).json({ error: "Venta no encontrada" });
        }

        const craft = await Craft.findByPk(sale.craftId);
        if (!craft) {
            return res.status(404).json({ error: "Artesanía no encontrada" });
        }

        // Devolver la cantidad al stock
        craft.stock += sale.quantity;
        await craft.save();

        // Eliminar la venta
        await sale.destroy();

        res.json({ message: "Venta eliminada exitosamente" });
    } catch (error) {
        console.error("Error al eliminar la venta:", error);
        res.status(500).json({ error: "Error al eliminar la venta" });
    }
});


app.get("/api/sales/all", async (req, res) => {
    try {
        const sales = await Sale.findAll({
            include: [
                {
                    model: Craft,
                    attributes: ["id", "title", "price"],
                },
                {
                    model: User,
                    attributes: ["id", "nombre", "telefono"],
                },
            ],
        });
        res.json(sales);
    } catch (error) {
        console.error("Error al obtener todas las ventas:", error);
        res.status(500).json({ error: "Error al obtener todas las ventas" });
    }
});















// Iniciar servidor


server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en http://0.0.0.0:${PORT}/`);
});
