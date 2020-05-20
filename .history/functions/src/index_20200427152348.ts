import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();
const cors = require('cors')({origin: true});
const conekta = require('conekta');

conekta.api_key = 'key_J1cLBV6qz5G5PsGBKP8yKQ';
conekta.api_version = '2.0.0';
conekta.locale = 'es';


// Pagos
exports.request = functions.https.onRequest((request, response) => {
    cors(request, response, () => {
        response.set('Access-Control-Allow-Origin', '*');
        response.set('Access-Control-Allow-Credentials', 'true');
        const origen = request.body.origen;
        const data = request.body.data;
        console.log(origen);
        console.log(data);
        if (origen === 'newCard') {
            return newCard(data)
            .then(() => response.status(200).send('Bien hecho esponja'))
            .catch(err => response.status(400).send('No pudimos completar el registro ' + err))
        } else {
            return doCharge(data)
            .then(() => response.status(200).send('Cargo autorizado'))
            .catch((err: any) => response.status(400).send('No pudimos hacer el cargo ' + err))
        }

    });
})

function newCard(cliente: ClienteToken) {
    let formaPago: any
    return admin.database().ref(`usuarios/${cliente.idCliente}/forma-pago/idConekta`).once('value')
    .then(res => res.val())
    .then(idConekta => {
        console.log(idConekta);
        if (!idConekta) {
            return createUser(cliente)
        }
        return addCard(idConekta, cliente.token)
    })
    .then((customer: any) => formaPago = customer)
    .then(() => admin.database().ref(`usuarios/${cliente.idCliente}/forma-pago/idConekta`).set(formaPago.idConekta))
    .then(() => admin.database().ref(`usuarios/${cliente.idCliente}/forma-pago/nueva`).set(formaPago.idCard))
    .catch(err => console.log(err))
}

function createUser(cliente: ClienteToken) {
    return new Promise(async (resolve, reject) => {
        try {
            const clienteInfo = await admin.auth().getUser(cliente.idCliente)
            if (clienteInfo.phoneNumber) {
                conekta.Customer.create({
                    'name': cliente.name,
                    'email': clienteInfo.email,
                    'phone': clienteInfo.phoneNumber,
                    'payment_sources': [{
                    'type': 'card',
                    'token_id': cliente.token
                    }]
                })
                .then((customer: any) => {
                    console.log(customer.toObject());
                    const newCliente = {
                        idCard: customer.toObject().default_payment_source_id,
                        idConekta: customer.toObject().id
                    }
                    console.log(newCliente);
                    resolve(newCliente)
                })
                .catch((err: any) => {
                    console.log(err)
                    reject(err)
                })
            } else {
                conekta.Customer.create({
                    'name': cliente.name,
                    'email': clienteInfo.email,
                    'payment_sources': [{
                        'type': 'card',
                        'token_id': cliente.token
                    }]
                })
                .then((customer: any) => {
                    console.log(customer.toObject());
                    const newCliente = {
                        idCard: customer.toObject().default_payment_source_id,
                        idConekta: customer.toObject().id
                    }
                    console.log(newCliente);
                    resolve(newCliente)
                })
                .catch((err: any) => {
                    console.log(err)
                    reject(err)
                })

            }
        } catch (error) {
            console.log(error);
            reject(error)
        }
    });
}

function addCard(idConekta: string, token: string) {
    return new Promise((resolve, reject) => {
        conekta.Customer.find(idConekta, function(_err: any, _customer: any) {
            _customer.createPaymentSource({
                type: 'card',
                token_id: token
            }, function(erre: any, res: any) {
                console.log('Tarjeta agregada');
                console.log(res);
                const newCliente = {
                    idCard: res.id,
                    idConekta: idConekta
                }
                resolve(newCliente)
            })
        })
    });
}

function doCharge(pedido: Pedido) {
    console.log('Do charge');
    const items: Item[] = []
    let idConekta: string;
    return new Promise((resolve, reject) => {        
        return admin.database().ref(`usuarios/${pedido.cliente.uid}/forma-pago/idConekta`).once('value')
        .then((snp) => snp.val())
        .then(idCon => idConekta = idCon)
        .then(() => conekta.Customer.find(idConekta))
        .then(cliente => {
            console.log(pedido.formaPago.id);
            cliente.update({
                default_payment_source_id: pedido.formaPago.id
            },
            function (err: any, customer: any){
                if (err) {
                    console.log(err);
                    reject(err)
                }
                console.log(customer.toObject());
                for (const producto of pedido.productos) {
                    console.log(producto);
                    const item: Item = {
                        id: producto.id,
                        name: producto.nombre,
                        unit_price: producto.total * 100,
                        quantity: 1
                    }
                    items.push(item)
                }
                console.log(items);
                conekta.Order.create({
                    currency: 'MXN',
                    customer_info: {
                        customer_id: idConekta
                    },
                    line_items: items,
                    charges: [{
                        payment_method: {
                            type: 'default'
                          } 
                    }]
                })
                .then((result: any) => {
                    console.log('Cargo autorizado');
                    console.log(result);
                    console.log(result.toObject());
                    resolve(true)
                })
                .catch((erra: any) => {
                    console.log('Error');
                    console.log(erra);
                    console.log(erra.details[0].message)
                    reject(erra.details[0].message)
                })
            })
        })
    });
}

export interface Item {
    id: string;
    name: string;
    unit_price: number;
    quantity: number;
}

// Propios de la interacción cliente - negocio - repartidor
exports.pedidoCreado = functions.database.ref('usuarios/{uid}/pedidos/activos/{idPedido}')
    .onCreate(async (snapshot, context) => {
        const pedido = snapshot.val();
        const idPedido = context.params.idPedido;
        const idNegocio = pedido.negocio.idNegocio;
        const negocio = pedido.negocio;
        const categoria = pedido.categoria;
        const region = await getRegion(idNegocio);
        pedido.productos.forEach(async (p: any) => {
            const vendidos =  {
                categoria,
                descripcion: p.descripcion,
                id: p.id,
                idNegocio: negocio.idNegocio,
                nombre: p.nombre,
                nombreNegocio: negocio.nombreNegocio,
                precio: p.precio,
                url: p.url,
            }
            await admin.database().ref(`vendidos/${region}/${p.id}/ventas`).transaction(ventas => ventas ? ventas + p.cantidad : p.cantidad);
            await admin.database().ref(`vendidos/${region}/${p.id}`).update(vendidos);
        });
        await admin.database().ref(`pedidos/activos/${idNegocio}/detalles/${idPedido}`).set(pedido);
        await admin.database().ref(`pedidos/activos/${idNegocio}/cantidad`).transaction(cantidad => cantidad ? cantidad + 1 : 1);
        return admin.database().ref(`tokens/${idNegocio}`).once('value')
        .then(data => {
            const token = data.val();
            if (token) {
                return sendFCM(token, 'Nuevo pedido');
            } else {
                return null;
            }
        })
        .catch(err => console.log(err));
    });

exports.solicitaRepartidor = functions.database.ref('pedidos/repartidor_pendiente/idPedido')
    .onCreate(async (snapshot, context) => {
        const idPedido = context.params.idPedido
        const pedido = snapshot.val()
    });

exports.onRepartidorAsignado = functions.database.ref('pedidos/activos/{idNegocio}/detalles/{idPedido}/repartidor')
    .onCreate(async (snapshot, context) => {
        const idPedido = context.params.idPedido;
        const idNegocio = context.params.idNegocio;
        const repartidor = snapshot.val();
        return admin.database().ref(`pedidos/activos/${idNegocio}/detalles/${idPedido}`).once('value')
                                .then(async (data: any) => {
                                    const pedido = data.val();
                                    pedido.idNegocio = idNegocio;
                                    const idCliente = pedido.cliente.uid
                                    await admin.database().ref(`asignados/${repartidor.id}/${idPedido}`).update(pedido);
                                    await admin.database().ref(`usuarios/${idCliente}/pedidos/activos/${idPedido}/repartidor`).set(repartidor);
                                    return admin.database().ref(`usuarios/${idCliente}/token`).once('value')
                                }).then((data: any) => {
                                    const token = data.val();
                                    if (token) {
                                        sendPushNotification(token, 'Repartidor asignado: ' + repartidor.nombre);
                                        return true;
                                    } else {
                                        return null;
                                    }
                                }).catch(err => console.log(err));
    });

exports.onRepartidorAsignadoUpdate = functions.database.ref('pedidos/activos/{idNegocio}/detalles/{idPedido}/repartidor')
    .onUpdate(async (change, context) => {
        const idPedido = context.params.idPedido;
        const idNegocio = context.params.idNegocio;
        const after = change.after.val();
        const before = change.before.val();
        if (before === after) {
            console.log('Repartidor didnt change');
            return null;
        }
        return admin.database().ref(`pedidos/activos/${idNegocio}/detalles/${idPedido}`).once('value')
                                .then(async (data: any) => {
                                    const pedido = data.val();
                                    const idCliente = pedido.cliente.uid
                                    return admin.database().ref(`usuarios/${idCliente}/pedidos/activos/${idPedido}/repartidor`).set(after);
                                    
                                }).catch(err => console.log(err));
    });

exports.pedidoAceptado = functions.database.ref('pedidos/activos/{idNegocio}/detalles/{idPedido}')
    .onUpdate(async (change, context) => {
        const idPedido = context.params.idPedido;
        const after = change.after.val();
        const before = change.before.val();
        if (before === after) {
            console.log('Aceptado didnt change');
            return null;
        }
        if (before.aceptado === after.aceptado) {
            console.log('Ya estaba aceptado');
            return null;
        }
        const idCliente = after.cliente.uid;
        const entrega = after.aceptado;
        if (after.entrega === 'inmediato') {
            const avance2: Avance[] = [
                {
                    fecha: Date.now(),
                    concepto: `${after.negocio.nombreNegocio} ha aceptado tu pedido`
                },
                {
                    fecha: Date.now(),
                    concepto: `${after.negocio.nombreNegocio} está preparando tus productos`
                },
                {
                    fecha: 0,
                    concepto: `El repartidor tiene tus productos y está en camino`
                },
                {
                    fecha: 0,
                    concepto: `El repartidor ha llegado a tu domicilio`
                },
                {
                    fecha: 0,
                    concepto: `Pedido entregado`
                },
            ]
            await admin.database().ref(`usuarios/${idCliente}/pedidos/activos/${idPedido}/avances`).set(avance2);
        } else {
            const avance: Avance = {
                fecha: Date.now(),
                concepto: `${after.negocio.nombreNegocio} ha aceptado tu pedido`
            }
            await admin.database().ref(`usuarios/${idCliente}/pedidos/activos/${idPedido}/avances`).push(avance);
        }
        await admin.database().ref(`usuarios/${idCliente}/pedidos/activos/${idPedido}/aceptado`).set(entrega);
        return admin.database().ref(`usuarios/${idCliente}/token`).once('value')
        .then((data: any) => {
            const token = data.val();
            if (token) {
                sendPushNotification(token, `${after.negocio.nombreNegocio} está preparando tu pedido`);
                return true;
            } else {
                return null;
            }
        })
        .catch((err) => console.log(err));
    });

exports.onMsgClienteAdded = functions.database.ref(`usuarios/{userId}/chat/todos/{idPedido}/{msgId}`)
    .onCreate(async (snapshot, context) => {
        const idPedido = context.params.idPedido;
        const userId = context.params.userId;
        const msg = snapshot.val();
        if (!msg.isMe) {
            return;
        }
        await admin.database().ref(`chatRepa/${msg.idRepartidor}/todos/${idPedido}`).push(msg);
        await admin.database().ref(`chatRepa/${msg.idRepartidor}/unread/${idPedido}/idPedido`).set(idPedido);
        await admin.database().ref(`chatRepa/${msg.idRepartidor}/unread/${idPedido}/idCliente`).set(userId);
        return await admin.database().ref(`chatRepa/${msg.idRepartidor}/unread/${idPedido}/cantidad`).transaction(cantidad => cantidad ? cantidad + 1 : 1);
        ////////////////////// Sólo falta push notification
        // return admin.database().ref(`carga/${vendedorId}/datos/token`).once('value')
        //     .then(async (snap: any)  => {
        //     const token = snap ? snap.val() : 'No hay';
        //     sendMsg(token, msg, 'mensaje');
        //     }).catch((err) => { console.log(err); });
    });

exports.onMsgVendedorAdded = functions.database.ref(`chatRepa/{idRepartidor}/todos/{idPedido}/{idMsg}`)
    .onCreate(async (snapshot, context) => {
        const msg = snapshot.val();
        if (msg.isMe) {
            return;
        }
        const userId = msg.idCliente;
        const idPedido = context.params.idPedido;
        const idRepartidor = context.params.idRepartidor;
        await admin.database().ref(`usuarios/${userId}/chat/todos/${idPedido}`).push(msg);
        await admin.database().ref(`usuarios/${userId}/chat/unread/${idPedido}/idPedido`).set(idPedido);
        await admin.database().ref(`usuarios/${userId}/chat/unread/${idPedido}/idRepartidor`).set(idRepartidor);
        await admin.database().ref(`usuarios/${userId}/chat/unread/${idPedido}/cantidad`).transaction(cantidad => cantidad ? cantidad + 1 : 1);
        return admin.database().ref(`usuarios/${userId}/token`).once('value')
            .then((data: any) => {
                const token = data.val();
                if (token) {
                    sendPushNotification(token, `Nuevo mensaje de ${msg.repartidor}`);
                    return true;
                } else {
                    return null;
                }
            })
            .catch((err) => console.log(err));
    });

exports.onMsgVendedorVisto = functions.database.ref('chatRepa/{idRepartidor}/unread/{idPedido}')
    .onDelete(async (snapshot, context) => {
        const info = snapshot.val();
        return admin.database().ref(`usuarios/${info.idCliente}/chat/status/${info.idPedido}`).set('visto');
    });

exports.onMsgClienteVisto = functions.database.ref('usuarios/{idCliente}/chat/unread/{idPedido}')
    .onDelete(async (snapshot, context) => {
        const info = snapshot.val();
        return admin.database().ref(`chatRepa/${info.idRepartidor}/status/${info.idPedido}`).set('visto');
    });

exports.onPedidoTerminado = functions.database.ref('asignados/{idRepartidor}/{idPedido}')
    .onDelete(async (snapshot, context) => {
        const pedido = snapshot.val();
        if (!pedido.entregado) {
            console.log('Se canceló');
            return null;
        } else {
            await admin.database().ref(`pedidos/historial/${pedido.idNegocio}/${pedido.id}`).update(pedido);
            await admin.database().ref(`pedidos/activos/${pedido.idNegocio}/cantidad`).transaction(cantidad => cantidad ? cantidad - 1 : 0);
            await admin.database().ref(`pedidos/activos/${pedido.idNegocio}/detalles/${pedido.id}`).remove();
            await admin.database().ref(`usuarios/chat/status/${pedido.id}`).remove();
            await admin.database().ref(`usuarios/chat/todos/${pedido.id}`).remove();
            await admin.database().ref(`usuarios/chat/unread/${pedido.id}`).remove();
            await admin.database().ref(`usuarios/${pedido.cliente.uid}/pedidos/historial/${pedido.id}`).set(pedido);
            return admin.database().ref(`usuarios/${pedido.cliente.uid}/pedidos/activos/${pedido.id}`).remove();
        }
    });

exports.onCalificacionAdded = functions.database.ref('usuarios/{idCliente}/pedidos/historial/{idPedido}/calificacion')
    .onCreate(async (snapshot, context) => {
        const calificacion = snapshot.val();
        const idPedido = context.params.idPedido;
        const idNegocio = calificacion.negocio.idNegocio;
        const idRepartidor = calificacion.repartidor.idRepartidor;
        calificacion.fecha = Date.now();
        calificacion.idPedido = idPedido;
        await admin.database().ref(`pedidos/historial/${idNegocio}/${idPedido}/calificacion`).update(calificacion);
        await admin.database().ref(`rate/detalles/${idNegocio}/${idPedido}`).update(calificacion.negocio);
        await admin.database().ref(`rate/resumen/${idNegocio}`).transaction(data => {
            if (data) {
                if (data.promedio) {
                    data.promedio = ((data.promedio * data.calificaciones) + calificacion.negocio.puntos)
                        / (data.calificaciones + 1);
                } else {
                    data.promedio = (5 + calificacion.negocio.puntos) / 2;
                }
                if (data.calificaciones) {
                    data.calificaciones = data.calificaciones + 1;
                } else {
                    data.calificaciones = 2;
                }
            }
            return data;
        })
        .then(data => console.log(data));
        await admin.database().ref(`repartidores/${idNegocio}/detalles/${idRepartidor}/comentarios/${idPedido}`).update(calificacion.repartidor);
        await admin.database().ref(`repartidores/${idNegocio}/preview/${idRepartidor}`).transaction(dato => {
            if (dato) {
                if (dato.promedio) {
                    dato.promedio = ((dato.promedio * dato.calificaciones) + calificacion.repartidor.puntos)
                        / (dato.calificaciones + 1);
                } else {
                    dato.promedio = (5 + calificacion.repartidor.puntos) / 2;
                }
                if (dato.calificaciones) {
                    dato.calificaciones = dato.calificaciones + 1;
                } else {
                    dato.calificaciones = 2;
                }
            }
            return dato;
        });
        const region = await getRegion(idNegocio);
        return admin.database().ref(`functions/${region}/${idNegocio}`).once('value')
                                .then(async (dates) => {
                                    const info = dates.val();
                                    if (info.abierto) {
                                        await admin.database().ref(`negocios/preview/${region}/${info.categoria}/${info.subCategoria}/abiertos/${idNegocio}`).transaction(datu => {
                                            if (datu) {
                                                if (datu.promedio) {
                                                    datu.promedio = ((datu.promedio * datu.calificaciones) + calificacion.negocio.puntos)
                                                        / (datu.calificaciones + 1);
                                                } else {
                                                    datu.promedio = (5 + calificacion.negocio.puntos) / 2;
                                                }
                                                if (datu.calificaciones) {
                                                    datu.calificaciones = datu.calificaciones + 1;
                                                } else {
                                                    datu.calificaciones = 2;
                                                }
                                            }
                                            return datu;
                                        });

                                        return admin.database().ref(`negocios/preview/${region}/${info.categoria}/todos/abiertos/${idNegocio}`).transaction(dati => {
                                            if (dati) {
                                                if (dati.promedio) {
                                                    dati.promedio = ((dati.promedio * dati.calificaciones) + calificacion.negocio.puntos)
                                                        / (dati.calificaciones + 1);
                                                } else {
                                                    dati.promedio = (5 + calificacion.negocio.puntos) / 2;
                                                }
                                                if (dati.calificaciones) {
                                                    dati.calificaciones = dati.calificaciones + 1;
                                                } else {
                                                    dati.calificaciones = 2;
                                                }
                                            }
                                            return dati;
                                        }).then(async (dati: any) => {
                                            const cal = {
                                                calificaciones: dati.calificaciones,
                                                promedio: dati.promedio
                                            };
                                            await admin.database().ref(`functions/${region}/${idNegocio}`).update(cal);
                                           return admin.database().ref(`busqueda/${region}/${idNegocio}`).update(cal);
                                        });
                                        
                                    } else {
                                        await admin.database().ref(`negocios/preview/${region}/${info.categoria}/${info.subCategoria}/cerrados/${idNegocio}`).transaction(date => {
                                            if (date) {
                                                if (date.promedio) {
                                                    date.promedio = ((date.promedio * date.calificaciones) + calificacion.negocio.puntos)
                                                        / (date.calificaciones + 1);
                                                } else {
                                                    date.promedio = (5 + calificacion.negocio.puntos) / 2;
                                                }
                                                if (date.calificaciones) {
                                                    date.calificaciones = date.calificaciones + 1;
                                                } else {
                                                    date.calificaciones = 2;
                                                }
                                            }
                                            return date;
                                        });
                                        return admin.database().ref(`negocios/preview/${region}/${info.categoria}/todos/cerrados/${idNegocio}`).transaction(datas => {
                                            if (datas) {
                                                if (datas.promedio) {
                                                    datas.promedio = ((datas.promedio * datas.calificaciones) + calificacion.negocio.puntos)
                                                        / (datas.calificaciones + 1);
                                                } else {
                                                    datas.promedio = (5 + calificacion.negocio.puntos) / 2;
                                                }
                                                if (datas.calificaciones) {
                                                    datas.calificaciones = datas.calificaciones + 1;
                                                } else {
                                                    datas.calificaciones = 2;
                                                }
                                            }
                                            return datas;
                                        }).then(async (datas: any) => {
                                            const cal = {
                                                calificaciones: datas.calificaciones,
                                                promedio: datas.promedio
                                            };
                                            await admin.database().ref(`functions/${region}/${idNegocio}`).update(cal);
                                           return admin.database().ref(`busqueda/${region}/${idNegocio}`).update(cal);
                                        });

                                    }
                                })
                                .catch(err => console.log(err));
    });
// Propios de administración, registros

exports.onProdEliminado = functions.database.ref('negocios/{tipo}/{categoria}/{idNegocio}/{pasillo}/{idProducto}')
    .onDelete(async (snapshot, context) => {
        const idNegocio = context.params.idNegocio;
        const idProducto = context.params.idProducto;
        const producto = snapshot.val();
        if (producto.mudar) {
            return;
        }
        const region = await getRegion(idNegocio);
        return admin.database().ref(`vendidos/${region}/${idProducto}`).remove();
    });

exports.onProdEdit = functions.database.ref('negocios/productos/{categoria}/{idNegocio}/{subCategoria}/{idProducto}')
    .onUpdate(async (change, context) => {
        const idProducto = context.params.idProducto;
        const idNegocio = context.params.idNegocio;
        const after = change.after.val();
        const before = change.before.val();
        if (before === after) {
            console.log('Aceptado didnt change');
            return null;
        }
        const region = await getRegion(idNegocio);
       return admin.database().ref(`vendidos/${region}/${idProducto}`).once('value', snapshot => {
        if (snapshot.exists()) {
            return admin.database().ref(`vendidos/${region}/${idProducto}`).update(after);
        } else {
            return null;
        }
       });
    });

exports.onCategoriaEdit = functions.database.ref('perfiles/{idNegocio}/categoria')
    .onUpdate(async (change, context) => {
        const idNegocio = context.params.idNegocio;
        const after = change.after.val();
        const before = change.before.val();
        if (before === after) {
            return null;
        }
        const region = await getRegion(idNegocio);
        return admin.database().ref(`vendidos/${region}`).orderByChild('idNegocio').equalTo(idNegocio).once('value', snapshot => {
            snapshot.forEach(child => {
                const childData = child.val();
                const childKey = child.key;
                childData.categoria = after;
                admin.database().ref(`vendidos/${region}/${childKey}`).update(childData)
                .then(() => true)
                .catch(() => null);
            });
        });
    })

exports.onNombreNegocioEdit = functions.database.ref('perfiles/{idNegocio}/nombre')
    .onUpdate(async (change, context) => {
        const idNegocio = context.params.idNegocio;
        const after = change.after.val();
        const before = change.before.val();
        if (before === after) {
            return null;
        }
        const region = await getRegion(idNegocio);
        return admin.database().ref(`vendidos/${region}`).orderByChild('idNegocio').equalTo(idNegocio).once('value', snapshot => {
            snapshot.forEach(child => {
                const childData = child.val();
                const childKey = child.key;
                childData.nombreNegocio = after;
                admin.database().ref(`vendidos/${region}/${childKey}`).update(childData)
                .then(() => true)
                .catch(() => null);
            });
        });
    })

exports.onNewRepartidor = functions.database.ref('nuevoColaborador/{idNegocio}/{idColaborador}')
    .onCreate(async (snapshot, context) => {
        const idNegocio = context.params.idNegocio;
        const repartidor = snapshot.val();
        try {
            const newUser = await admin.auth().createUser({
                disabled: false,
                displayName: repartidor.detalles.user,
                email: repartidor.detalles.correo,
                password: repartidor.detalles.pass,
                photoURL: repartidor.preview.foto || null,
                emailVerified: true,
            });
            repartidor.preview.id = newUser.uid;
            repartidor.preview.calificaciones = 1;
            repartidor.preview.promedio = 5;
            await admin.database().ref(`repartidores/${idNegocio}/preview/${repartidor.preview.id}`).set(repartidor.preview);
            await admin.database().ref(`repartidores/${idNegocio}/detalles/${repartidor.preview.id}`).set(repartidor.detalles);
            return admin.database().ref(`result/${idNegocio}`).push('ok');
        } catch (error) {
            return admin.database().ref(`result/${idNegocio}`).push(error.errorInfo.code);
        }
    });

exports.onPassChanged = functions.database.ref('repartidores/{idNegocio}/detalles/{idRepartidor}/pass')
    .onUpdate(async (change, context) => {
        const idColaborador = context.params.idColaborador;
        const after = change.after.val();
        const before = change.before.val();
        if (before === after) {
            console.log('Pass didnt change');
            return null;
        }
        return await admin.auth().updateUser(idColaborador, {
            password: after
        });
    });

exports.onDisplayNameChanged = functions.database.ref('repartidores/{idNegocio}/detalles/{idRepartidor}/user')
    .onUpdate(async (change, context) => {
        const idColaborador = context.params.idColaborador;
        const after = change.after.val();
        const before = change.before.val();
        if (before === after) {
            console.log('Nombre didnt change');
            return null;
        }
        return await admin.auth().updateUser(idColaborador, {
            displayName: after
        });
    });

exports.onFotoChanged = functions.database.ref('repartidores/{idNegocio}/preview/{idRepartidor}/foto')
    .onUpdate(async (change, context) => {
        const idColaborador = context.params.idColaborador;
        const after = change.after.val();
        const before = change.before.val();
        if (before === after) {
            console.log('Foto didnt change');
            return null;
        }
        return await admin.auth().updateUser(idColaborador, {
            photoURL: after
        });
    });

exports.onRepartidorDeleted = functions.database.ref('repartidores/{idNegocio}/detalles/{idColaborador}')
    .onDelete(async (snapshot, context) => {
        const idColaborador = context.params.idColaborador;
        return admin.auth().deleteUser(idColaborador);
    });

exports.checkIsOpen = functions.pubsub.schedule('every 15 minutes').onRun(async (context) => {
    const dateMX = new Date().toLocaleString("en-US", {timeZone: "America/Mexico_City"});
    const date = new Date(dateMX);
    let dia = date.getDay();
    if (dia === 0) {
      dia = 6;
    } else {
      dia--;
    }
    let ahora = 0;
    const horas = date.getHours();
    const horasEnMin = horas * 60;
    const minutos = date.getMinutes();
    ahora = minutos + horasEnMin;
    try {
        const negociosActivos = await admin.database().ref(`horario/analisis/${dia}`).orderByChild('activo').equalTo(true).once('value');
        Object.entries(negociosActivos.val()).forEach((n: any) => {
            if (n[1].activo &&
                n[1].apertura < ahora &&
                n[1].cierre > ahora) {
                // Dentro del horario, comprobar si tiene horario de comida
                if (n[1].inicioComida &&
                    n[1].finComida ) {
                    // Dentro del horario y cierra por comida, comprobemos si no está en tiempo de comida
                    if (n[1].inicioComida &&
                    n[1].inicioComida < ahora &&
                    n[1].finComida &&
                    n[1].finComida > ahora) {       
                        // Está dentro del horario de comida, comprobar si está cerrado
                        if (n[1].abierto) {
                            return cierraNegocio(n[0], dia.toString());
                        } else {
                            return null;
                        }
                    } else {
                        // No están en horario de comida, comprobemos si está abierto
                        if (!n[1].abierto) {
                            return abreNegocio(n[0], dia.toString());
                        } else {
                            return null;
                        }
                    }
                } else {
                    // Dentro del horario y es corrido, comprobar si está abierto
                    if (!n[1].abierto) {
                        return abreNegocio(n[0], dia.toString());
                    } else {
                        return null;
                    }
                }
            } else {
                // Está fuera del horario, comprobar si está cerrado
                if (n[1].abierto) {
                    return cierraNegocio(n[0], dia.toString());
                } else {
                    return null;
                }
            }
        });
        return null;
    } catch (error) {
        console.log(error);
        return null;
    }
});


// Functions

async function cierraNegocio(idNegocio: string, dia: string) {
    let categoria = '';
    let subCategoria: any = [];
    let datosNegocio: any = {};
    const region = await getRegion(idNegocio);
    admin.database().ref(`functions/${region}/${idNegocio}`).once('value')
                    .then(inf => {
                        const info = inf.val();
                        categoria = info.categoria;
                        subCategoria = info.subCategoria;
                        return admin.database().ref(`negocios/preview/${region}/${info.categoria}/todos/abiertos/${idNegocio}`).once('value');
                    }).then(res => {
                        datosNegocio = res.val();
                        datosNegocio.abierto = false;
                        return admin.database().ref(`negocios/preview/${region}/${categoria}/todos/cerrados/${idNegocio}`).update(datosNegocio);
                    }).then(() => {
                        subCategoria.forEach(async (s: string) => {
                            await admin.database().ref(`negocios/preview/${region}/${categoria}/${s}/cerrados/${idNegocio}`).update(datosNegocio);
                        });
                    }).then(() => {
                        return admin.database().ref(`negocios/preview/${region}/${categoria}/todos/abiertos/${idNegocio}`).remove();
                    }).then(() => {
                        subCategoria.forEach(async (s: string) => {
                            await admin.database().ref(`negocios/preview/${region}/${categoria}/${s}/abiertos/${idNegocio}`).remove();
                        });
                    }).then(() => {
                        return admin.database().ref(`perfiles/${idNegocio}`).update({abierto: false});
                    }).then(() => {
                        return admin.database().ref(`horario/analisis/${dia}/${idNegocio}`).update({abierto: false});
                    }).then(() => {
                        return admin.database().ref(`functions/${region}/${idNegocio}`).update({abierto: false});
                    }).then(() => {
                        return admin.database().ref(`busqueda/${region}/${idNegocio}`).update({abierto: false});
                    }).then(() => {
                        return admin.database().ref(`isOpen/${region}/${idNegocio}/abierto`).set(false);
                    }).catch(err => console.log(err));
}

async function abreNegocio(idNegocio: string, dia: string) {
    let categoria = '';
    let subCategoria: any = [];
    let datosNegocio: any = {};
    const region = await getRegion(idNegocio);
    admin.database().ref(`functions/${region}/${idNegocio}`).once('value')
                    .then(inf => {
                        const info = inf.val();
                        categoria = info.categoria;
                        subCategoria = info.subCategoria;
                        return admin.database().ref(`negocios/preview/${region}/${info.categoria}/todos/cerrados/${idNegocio}`).once('value');
                        
                    }).then(res => {
                        datosNegocio = res.val();
                        datosNegocio.abierto = true;
                        return admin.database().ref(`negocios/preview/${region}/${categoria}/todos/abiertos/${idNegocio}`).update(datosNegocio);
                    }).then(() => {
                        subCategoria.forEach(async (s: string) => {
                            await admin.database().ref(`negocios/preview/${region}/${categoria}/${s}/abiertos/${idNegocio}`).update(datosNegocio);
                        });
                        return true;
                    }).then(() => {
                        return admin.database().ref(`negocios/preview/${region}/${categoria}/todos/cerrados/${idNegocio}`).remove();
                    }).then(() => {
                        subCategoria.forEach(async (s: string) => {
                            return admin.database().ref(`negocios/preview/${region}/${categoria}/${s}/cerrados/${idNegocio}`).remove();
                        });
                    }).then(() => {
                        return admin.database().ref(`perfiles/${idNegocio}`).update({abierto: true});
                    }).then(() => {
                        return admin.database().ref(`horario/analisis/${dia}/${idNegocio}`).update({abierto: true});
                    }).then(() => {
                        return admin.database().ref(`functions/${region}/${idNegocio}`).update({abierto: true});
                    }).then(() => {
                        return admin.database().ref(`busqueda/${region}/${idNegocio}`).update({abierto: true});
                    }).then(() => {
                        return admin.database().ref(`isOpen/${region}/${idNegocio}/abierto`).set(true);
                    }).catch(err => console.log(err));
}

function sendPushNotification(token: string, msn: string) {
    const sendNotification = function(msg: any) {
        const headers = {
          "Content-Type": "application/json; charset=utf-8"
        };
        
        const options = {
          host: "onesignal.com",
          port: 443,
          path: "/api/v1/notifications",
          method: "POST",
          headers: headers
        };
        
        const https = require('https');
        const req = https.request(options, function(res: any) {  
          res.on('data', function(resp: any) {
            console.log("Response:");
            console.log(JSON.parse(resp));
          });
        });
        
        req.on('error', function(e: any) {
          console.log("ERROR:");
          console.log(e);
        });
        
        req.write(JSON.stringify(msg));
        req.end();
    };

    const message = { 
        app_id: "0450c0cf-ee73-4fcf-ac05-53a355468933",
        contents: {"en": msn},
        include_player_ids: [token],
        
    };
      
    sendNotification(message);
}

function sendFCM(token: string, mensaje: string) {
    const payload = {
        notification: {
            title: 'Spot',
            body: mensaje,
            click_action: 'https://revistaojo-9a8d3.firebaseapp.com',
            icon: 'https://firebasestorage.googleapis.com/v0/b/revistaojo-9a8d3.appspot.com/o/logotipos%2Fic_stat_onesignal_default.png?alt=media&token=be09f858-6a1c-4a52-b5ad-717e1eac1d50'
        },
      };
      const options = {
          priority: "high"
      }
      return admin.messaging().sendToDevice(token, payload, options)
}

function getRegion(idNegocio: string) {
    return new Promise((resolve, reject) => {
        admin.database().ref(`perfiles/${idNegocio}/region`).once('value')
        .then(region => {
            resolve(region.val());
        })
        .catch(err => {
            console.log(err);
            reject(err);
        });
    });
}
export interface Avance {
    fecha: number;
    concepto: string;
}

export interface ClienteToken {
    token: string;
    idCliente: string;
    name: string;
}

export interface Pedido {
    cliente: Cliente;
    id: string;
    formaPago: FormaPago;
    productos: Producto[];
    total: number;
}

export interface FormaPago {
    forma: string;
    tipo: string;
    id: string;
}

export interface Cliente {
    direccion: string;
    nombre: string;
    telefono: string;
    uid: string;
}

export interface Producto {
    codigo: string;
    descripcion: string;
    id: string;
    nombre: string;
    pasillo: string;
    precio: number;
    unidad: string;
    url: string;
    variables: boolean;
    cantidad?: number;
    complementos?: ListaComplementosElegidos[];
    observaciones?: string;
    total: number;
}

export interface ListaComplementosElegidos {
    titulo: string;
    complementos: Complemento[];
}
export interface Complemento {
    nombre: string;
    precio: number;
    isChecked?: boolean;
    deshabilitado?: boolean;
}